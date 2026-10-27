#!/bin/sh
# Prints the CHANGELOG.md section of a version (without its "## [x.y.z]" heading).
# Usage: release-notes.sh 1.2.0   (a leading "v" is ignored)
set -eu
version="${1#v}"
notes=$(awk -v ver="$version" '
	index($0, "## [" ver "]") == 1 { found = 1; next }
	found && /^## / { exit }
	found { print }
' CHANGELOG.md)
if [ -z "$notes" ]; then
	echo "No section for $version in CHANGELOG.md" >&2
	exit 1
fi
printf '%s\n' "$notes"
