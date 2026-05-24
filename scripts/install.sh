#!/bin/bash

# Install stx-skills to a target project.
# Usage: ./install.sh /path/to/target/project [--cursor|--both]
#
# Prefer `npx ../stx-skills` from the target project — this bash script
# is the dependency-free fallback for Claude-only installs.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  stx-skills Installer${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════${NC}"
echo

if [ -z "$1" ]; then
    echo -e "${YELLOW}Usage: $0 /path/to/target/project${NC}"
    echo
    echo "Examples:"
    echo "  $0 /Users/me/projects/my-app"
    echo "  $0 ."
    exit 1
fi

TARGET_DIR="$1"
if [[ "$TARGET_DIR" != /* ]]; then
    TARGET_DIR="$(pwd)/$TARGET_DIR"
fi

if [ ! -d "$TARGET_DIR" ]; then
    echo -e "${RED}Error: target directory does not exist: $TARGET_DIR${NC}"
    exit 1
fi

echo -e "Package: ${CYAN}$PACKAGE_DIR${NC}"
echo -e "Target:  ${CYAN}$TARGET_DIR${NC}"
echo

# Build if needed
if [ ! -d "$PACKAGE_DIR/dist" ] || [ -z "$(ls -A "$PACKAGE_DIR/dist/skills" 2>/dev/null)" ]; then
    echo -e "${YELLOW}Building package...${NC}"
    (cd "$PACKAGE_DIR" && npm install --silent && npm run build)
    echo -e "${GREEN}✓ Build complete${NC}"
    echo
fi

SKILLS_SRC="$PACKAGE_DIR/.claude/skills"
SKILLS_DEST="$TARGET_DIR/.claude/skills"

mkdir -p "$SKILLS_DEST"

install_one() {
    local name="$1"
    local src_dir="$SKILLS_SRC/$name"
    local dest_dir="$SKILLS_DEST/$name"

    [ -d "$src_dir" ] || { echo -e "  ${YELLOW}skip $name (not in package)${NC}"; return; }

    mkdir -p "$dest_dir"
    cp -R "$src_dir/"* "$dest_dir/"

    local js="$PACKAGE_DIR/dist/skills/$name.js"
    if [ -f "$js" ]; then
        cp "$js" "$dest_dir/"
        chmod +x "$dest_dir/$name.js"
    fi
    if [ -f "$js.map" ]; then
        cp "$js.map" "$dest_dir/"
    fi

    echo -e "  ${GREEN}✓${NC} $name"
}

echo -e "Installing skills..."
for name in $(ls -1 "$SKILLS_SRC"); do
    if [ -d "$SKILLS_SRC/$name" ]; then
        install_one "$name"
    fi
done

echo
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Installation complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════════${NC}"
echo
echo "Slash commands now available in the target project:"
for name in $(ls -1 "$SKILLS_SRC"); do
    if [ -d "$SKILLS_SRC/$name" ]; then
        echo "  /$name"
    fi
done
echo
