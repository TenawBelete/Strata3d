# Public release readiness

Strata3d is preparing an open source release. The [MIT License](../LICENSE) applies to original Strata source code and documentation. Third-party code, imagery, geometry, textures, datasets, and capture outputs retain their own terms. An asset without a verified redistribution grant is pending review.

| Material | Evidence in this repository | Remaining decision |
| --- | --- | --- |
| Original Strata code and documentation | [MIT License](../LICENSE) selected by the maintainer | Preserve the copyright and license text in redistributed copies |
| Three.js | [Bundled license](../vendor/three/LICENSE) | Preserve its copyright and license notice |
| Bundled Draco decoder | [Bundled Apache 2.0 license](../vendor/draco/LICENSE) | Confirm the exact decoder build and any additional notices before release |
| Plaza Mayor reference photos | [Survey source records](../data/plaza-mayor-survey-source.json) identify the 2016 and 2020 sources and their CC BY-SA licenses | Map derived files to the correct source and record attribution and share-alike terms |
| Madrid municipal 3D mesh | [Exterior source record](../data/panaderia/exterior-source.json) identifies the source tiles and conversion | Confirm the terms for redistributing the GLB and its embedded textures |
| Walkthrough, street textures, and remaining scene data | `data/` and any derivatives | Inventory file-level sources and verify redistribution terms |

Track asset decisions in [issue #8](https://github.com/TenawBelete/Strata3d/issues/8) and the walkthrough inventory in [sub-issue #11](https://github.com/TenawBelete/Strata3d/issues/11). Record the source, creator, terms, attribution, and changes for each released asset. Document which assets are excluded and how to run the demo with cleared inputs.

Before changing visibility, review all branches, tags, and Git history for material that cannot be shared. Removing a file from the latest commit leaves older copies in history. If some assets cannot be cleared, prepare a public snapshot with only cleared files and keep the existing private repository as the development archive.

Review open and closed issues, pull requests, workflow logs, and artifacts for private material. Verify the public build from a fresh checkout, then check branch rules and the vulnerability reporting path. Treat Pages publication and project board visibility as separate settings.

## Hosted services and runtime assets

- **Cesium ion and Google Photorealistic 3D Tiles:** Earth streams vendor content. Keep account tokens out of Git, confirm the deployment's entitlement, show the required attribution, and do not bundle streamed tiles in the release. [Google Map Tiles policies](https://developers.google.com/maps/documentation/tile/policies)
- **OpenStreetMap and Nominatim:** Provide OpenStreetMap attribution. The public geocoder has an aggregate limit of one request per second per application and requires an identifiable request and a switchable service. Review the production configuration before opening the demo to general traffic. [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/)
- **Open-Meteo:** Weather data is CC BY 4.0 with attribution. The free hosted API is for noncommercial use. Verify the hosted plan before commercial deployment. [Open-Meteo](https://open-meteo.com/)
- **External models and street imagery:** The Earth mode references Khronos sample models, Three.js examples, and Mapillary imagery. Review each model's credits and the imagery terms before copying these into the repository or packaging them in a release.
- **Apple RealityKit and FFmpeg:** These are tools used to build captures. Keep their binaries outside the release and audit the footage and resulting assets separately.
