import Foundation
import RealityKit

@main struct Reconstruct {
    static func main() async throws {
        let args = CommandLine.arguments
        guard args.count == 6, PhotogrammetrySession.isSupported else {
            throw NSError(domain: "Object Capture requires a supported Mac and five arguments", code: 1)
        }
        var config = PhotogrammetrySession.Configuration()
        config.sampleOrdering = args[5] == "multi" ? .unordered : .sequential
        config.featureSensitivity = .high
        config.isObjectMaskingEnabled = false
        let session = try PhotogrammetrySession(input: URL(fileURLWithPath: args[1]), configuration: config)
        let detail: PhotogrammetrySession.Request.Detail = args[4] == "preview" ? .preview : (args[4] == "full" ? .full : .medium)
        let model = PhotogrammetrySession.Request.modelFile(url: URL(fileURLWithPath: args[2], isDirectory: true), detail: detail)
        try session.process(requests: [.poses, model])
        for try await event in session.outputs {
            switch event {
            case .requestError(_, let error): throw error
            case .requestComplete(_, .poses(let result)):
                // Sample identifiers need not follow input file order. The extractor
                // numbers frames with fixed-width filenames in capture order.
                let ids = result.posesBySample.keys.sorted {
                    (result.urlsBySample[$0]?.lastPathComponent ?? String(format: "%06d", $0)) <
                    (result.urlsBySample[$1]?.lastPathComponent ?? String(format: "%06d", $1))
                }
                let cameras: [[String: Any]] = ids.map { id in
                    let p = result.posesBySample[id]!
                    return ["frame": result.urlsBySample[id]?.lastPathComponent ?? String(id),
                            "position": [p.translation.x,p.translation.y,p.translation.z],
                            "rotation": [p.rotation.imag.x,p.rotation.imag.y,p.rotation.imag.z,p.rotation.real]]
                }
                try JSONSerialization.data(withJSONObject: cameras).write(to: URL(fileURLWithPath: args[3]))
            case .processingComplete: return
            case .processingCancelled: throw CancellationError()
            default: continue
            }
        }
    }
}
