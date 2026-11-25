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

## Asset inventory and release scope

The [file-level inventory](asset-inventory.csv) covers tracked data and capture files on the reviewed branch. A hold means the file stays outside public exports until its provenance, applicable terms, and any attribution are verified. It does not establish that the material is prohibited.

Madrid's ArcGIS item for the textured mesh contains no license or attribution text. Madrid publishes reuse terms for a separate 3D building dataset. Those terms alone do not establish the rights to the exact textured tiles used here. [Textured mesh item](https://www.arcgis.com/home/item.html?id=d8bcbe7422a048a6837dafad300ef2be) · [Separate building dataset](https://geoportal.madrid.es/IDEAM_WBGEOPORTAL/dataset.iam?id=ece2d15a-d16f-46e8-aaec-9576771b9997)

IGN publishes reuse conditions compatible with CC BY 4.0 for covered datasets. Confirm the exact products and any layer-specific credits before including the processed imagery or elevation files. [IGN data policy](https://www.ign.es/web/politica-datos)

The asset-excluded public release is [Eutopia4D](https://github.com/TenawBelete/Eutopia4D). Add assets there only once they are cleared, together with their license and attribution records.

## Verified license terms

| Material or source | Terms to carry forward |
| --- | --- |
| Original Strata code and documentation | [MIT](../LICENSE). Retain the copyright and permission notice. |
| Three.js | [Upstream MIT](../vendor/three/LICENSE). Retain the upstream copyright and license notice. |
| Draco | [Apache 2.0 and bundled notices](../vendor/draco/LICENSE). Preserve applicable notices, include the license, and identify modifications where required. |
| Björn S.'s 2016 source photograph | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Credit the creator, link the source and license, and preserve share-alike terms for distributed adaptations. |
| Nemo's 2020 source photograph | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Credit the creator, link the source and license, indicate modifications, and apply share-alike terms to distributed adaptations. |
| Covered IGN products | Follow [IGN's data policy](https://www.ign.es/web/politica-datos), including product-specific source credit. Confirm which terms apply to each exported layer. |

The source photographs and their processing notes are listed in the [survey source record](../data/plaza-mayor-survey-source.json). Confirm the mapping from the source photographs to every file carrying their pixels before shipping those files. No redistribution license has been verified for the exact Madrid mesh or the remaining undocumented textures.
