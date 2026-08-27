{
  description = "Node.js development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            corepack_22 # Quản lý yarn/pnpm đi kèm node
            nodePackages.pnpm
            nodePackages.yarn
            bun
          ];

          shellHook = ''
            export PATH="$PWD/node_modules/.bin:$PATH"
            echo "🚀 Node.js dev environment ready ($(node --version))"
          '';
        };
      });
}
