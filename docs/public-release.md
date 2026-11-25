# Public release readiness

Strata3d is preparing an open source release. The maintainer must select a license for the original project code. Third-party code and scene assets retain their own terms.

| Material | Evidence in this repository | Remaining decision |
| --- | --- | --- |
| Original Strata code | No root license | Confirm ownership and choose a code license |
| Three.js | [Bundled license](../vendor/three/LICENSE) | Preserve its copyright and license notice |
| Bundled Draco decoder | Decoder JavaScript and WASM in `vendor/draco/` | Record the upstream version and include its applicable notices |
| Plaza Mayor reference photos | [Survey source records](../data/plaza-mayor-survey-source.json) identify the 2016 and 2020 sources and their CC BY-SA licenses | Map derived files to the correct source and record attribution and share-alike terms |
| Madrid municipal 3D mesh | [Exterior source record](../data/panaderia/exterior-source.json) identifies the source tiles and conversion | Confirm the terms for redistributing the GLB and its embedded textures |
| Walkthrough, street textures, and remaining scene data | `data/` and any derivatives | Inventory file-level sources and verify redistribution terms |

Track asset decisions in [issue #8](https://github.com/TenawBelete/Strata3d/issues/8) and the walkthrough inventory in [sub-issue #11](https://github.com/TenawBelete/Strata3d/issues/11). Record the source, creator, terms, attribution, and changes for each released asset. Document which assets are excluded and how to run the demo with cleared inputs.

Before changing visibility, review all branches, tags, and Git history for material that cannot be shared. Removing a file from the latest commit leaves older copies in history. If some assets cannot be cleared, prepare a public snapshot with only cleared files and keep the existing private repository as the development archive.

Review open and closed issues, pull requests, workflow logs, and artifacts for private material. Verify the public build from a fresh checkout, then check branch rules and the vulnerability reporting path. Treat Pages publication and project board visibility as separate settings.
