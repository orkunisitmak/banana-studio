# Linux binary dependencies and source access

This is an unsigned development alpha, not an updated or signed production release.

- Node.js 24.19.0 is the unmodified official Linux x64 distribution. Its full license and bundled-library notices are in Node-LICENSE.txt. Source: https://nodejs.org/dist/v24.19.0/node-v24.19.0.tar.gz
- Electron 44.10.0 is the unmodified official Linux x64 release (the executable is renamed). LICENSE and LICENSES.chromium.html remain at the application root. Source and Chromium source references: https://github.com/electron/electron/tree/v44.10.0 and https://github.com/electron/electron/releases/tag/v44.10.0
- sharp 0.35.5 source: https://github.com/lovell/sharp/tree/v0.35.5
- libvips and statically incorporated libraries come from the unmodified @img/sharp-libvips-linux-x64 1.3.4 package. The exact versions are in workspace/node_modules/@img/sharp-libvips-linux-x64/versions.json. Its LICENSE.txt includes full component license texts, attribution documents, upstream source references and the matching sharp-libvips build recipe. Build files, patches and versioned source download locations: https://github.com/lovell/sharp-libvips/tree/v1.3.4

LGPL libraries are used through a separately replaceable shared library. Users may replace/relink the libvips shared library in workspace/node_modules/@img/sharp-libvips-linux-x64/lib/ with a compatible build and rebuild sharp from the sources above. No signature, integrity check at application launch or other mechanism prohibits modifications, debugging or replacement for this purpose. SHA256SUMS is a transport/verification inventory, not an execution restriction.

Before any public redistribution, maintainers must ensure equivalent corresponding sources (including applicable dependency sources, build recipes and patches) remain obtainable under the relevant licenses; upstream source links are not a maintainer's written source offer. No public redistribution is performed by these packaging scripts. The Node/Electron archives, exact npm tarballs and their SHA-256 pins are listed in node-runtime.json and runtime-lock.json. Build tools and system-provided libraries retain their distribution licenses and are not bundled here.
