"use strict";
// Nothing in this project parses TOML. The only thing that asks for this package is Anchor's "workspace"
// helper, which reads an Anchor.toml from a developer's folder and is never called here. The published
// parser has open advisories and no fixed release, so it is not installed at all: this stands in its place
// and refuses loudly if anything ever does call it.
exports.parse = function parse() {
  throw new Error("TOML parsing is not available in this project (see ADVISORIES.md)");
};
