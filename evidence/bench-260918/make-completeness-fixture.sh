#!/usr/bin/env bash
# Build a known-ground-truth tree for measuring whether search completeness
# metadata actually flags silent misses.
#
# Layout lives under the session tmp dir (not this repo) so the measurement
# cannot be polluted by aside-codemode's own .gitignore.
set -euo pipefail

SENTINEL="${SENTINEL:-ZQXJ_SENTINEL_7741}"
ABSENT="${ABSENT:-ZQXJ_ABSENT_0000_NEVER}"

SESSION_TMP="${SESSION_TMP:-${TMPDIR:-/tmp}}"
ROOT="${ROOT:-$SESSION_TMP/completeness-fixture}"
TARGET="${TARGET:-$SESSION_TMP/completeness-symlink-target}"

rm -rf "$ROOT" "$TARGET"
mkdir -p \
  "$ROOT/corpus/visible" \
  "$ROOT/corpus/ignored-dir/nested" \
  "$ROOT/corpus/.secret/nested" \
  "$ROOT/corpus/node_modules/pkg" \
  "$ROOT/sym-area" \
  "$TARGET/nested"

write_hit() {
  local path="$1"
  local tag="$2"
  printf '%s %s\n' "$SENTINEL" "$tag" > "$path"
}

# (a) plain visible files — always expected to be found.
# Eight files so a deliberate max=2 is unambiguously truncated.
for i in 1 2 3 4 5 6 7 8; do
  write_hit "$ROOT/corpus/visible/v${i}.txt" "visible-${i}"
done

# (b) files inside a directory excluded by the fixture-root .gitignore.
write_hit "$ROOT/corpus/ignored-dir/ign1.txt" "ignored-1"
write_hit "$ROOT/corpus/ignored-dir/ign2.txt" "ignored-2"
write_hit "$ROOT/corpus/ignored-dir/nested/ign3.txt" "ignored-3"

# (c) files inside a dot-directory (hidden from default ripgrep).
write_hit "$ROOT/corpus/.secret/hid1.txt" "hidden-1"
write_hit "$ROOT/corpus/.secret/nested/hid2.txt" "hidden-2"

# (d) files behind a symlinked directory. The real files live outside the
# fixture but inside $HOME, which is a configured search root. The
# search of the fixture sees only the door, not the files, unless links are
# followed (codemode refuses followSymlinks:true).
write_hit "$TARGET/link1.txt" "linked-1"
write_hit "$TARGET/link2.txt" "linked-2"
write_hit "$TARGET/nested/link3.txt" "linked-3"
ln -s "$TARGET" "$ROOT/sym-area/link-door"

# Extra concealment axis that config 3 is specifically about: a directory
# name that matches the host excludeGlobs ("node_modules"). Not in .gitignore,
# so plain rg would see these and default codemode would not.
write_hit "$ROOT/corpus/node_modules/pkg/nm1.txt" "nm-1"
write_hit "$ROOT/corpus/node_modules/pkg/nm2.txt" "nm-2"

# Fixture-root gitignore. A real .git is created so ripgrep treats this as a
# repository and actually honours .gitignore (rg ignores .gitignore files that
# are not inside a git work tree).
cat > "$ROOT/.gitignore" <<'EOF'
# Concealment (b): hide the ignored-dir tree from default searches.
corpus/ignored-dir/
EOF

# A non-matching file so an empty-query confusion cannot masquerade as a hit.
printf 'no sentinel here\n' > "$ROOT/corpus/visible/README.md"
printf 'fixture marker, no sentinel\n' > "$ROOT/README.md"

git init -q "$ROOT"
# Identity is local to this throwaway repo so git does not need a user.
git -C "$ROOT" -c user.name='fixture' -c user.email='fixture@example.test' add .gitignore README.md corpus/visible corpus/.secret corpus/node_modules sym-area
# ignored-dir is gitignored on purpose and must stay untracked.
git -C "$ROOT" -c user.name='fixture' -c user.email='fixture@example.test' commit -q -m 'completeness fixture'

# Manifest lives OUTSIDE the search tree so the inventory cannot become a hit.
# The sentinel string is stored split so even this file is not a match.
MANIFEST="${MANIFEST:-$SESSION_TMP/completeness-fixture-MANIFEST.txt}"
{
  echo "SENTINEL_PREFIX=ZQXJ_SENTINEL_"
  echo "SENTINEL_SUFFIX=7741"
  echo "ABSENT_PREFIX=ZQXJ_ABSENT_"
  echo "ABSENT_SUFFIX=0000_NEVER"
  echo "ROOT=$ROOT"
  echo "TARGET=$TARGET"
  echo "CORPUS=$ROOT/corpus"
  echo "--- files ---"
} > "$MANIFEST"

python3 - "$ROOT" "$TARGET" "$SENTINEL" "$MANIFEST" <<'PY'
import os, sys
root, target, sentinel, manifest = sys.argv[1:]

def files_under(path):
    out = []
    for dirpath, dirnames, filenames in os.walk(path, followlinks=False):
        # Do not walk into the symlink door; the target is enumerated separately.
        dirnames[:] = [d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))]
        for name in filenames:
            p = os.path.join(dirpath, name)
            if os.path.islink(p):
                continue
            try:
                with open(p, 'r', encoding='utf-8') as f:
                    text = f.read()
            except (OSError, UnicodeDecodeError):
                continue
            if sentinel in text:
                out.append(p)
    return out

hits = sorted(set(files_under(root) + files_under(target)))
categories = {
    'visible': [],
    'ignored': [],
    'hidden': [],
    'symlink_target': [],
    'exclude_globs_node_modules': [],
    'other': [],
}
for p in hits:
    if '/corpus/visible/' in p:
        categories['visible'].append(p)
    elif '/corpus/ignored-dir/' in p:
        categories['ignored'].append(p)
    elif '/corpus/.secret/' in p:
        categories['hidden'].append(p)
    elif p.startswith(target + os.sep) or p == target:
        categories['symlink_target'].append(p)
    elif '/corpus/node_modules/' in p:
        categories['exclude_globs_node_modules'].append(p)
    else:
        categories['other'].append(p)

in_fixture_no_follow = (
    len(categories['visible'])
    + len(categories['ignored'])
    + len(categories['hidden'])
    + len(categories['exclude_globs_node_modules'])
    + len(categories['other'])
)

with open(manifest, 'a', encoding='utf-8') as f:
    f.write(f'TOTAL_ON_DISK={len(hits)}\n')
    f.write(f'TOTAL_IN_FIXTURE_NO_FOLLOW={in_fixture_no_follow}\n')
    f.write(f'TOTAL_CORPUS={in_fixture_no_follow}\n')
    for k, rows in categories.items():
        f.write(f'COUNT_{k}={len(rows)}\n')
    f.write('--- paths ---\n')
    for k, rows in categories.items():
        for p in rows:
            f.write(f'{k}\t{p}\n')

print(f'wrote {len(hits)} sentinel files')
for k, rows in categories.items():
    print(f'  {k}: {len(rows)}')
print(f'  in_fixture_no_follow: {in_fixture_no_follow}')
PY

# Ground-truth tree for humans (no find(1) in the measurement path).
{
  echo
  echo '--- tree ---'
  python3 - "$ROOT" "$TARGET" <<'PY'
import os, sys
root, target = sys.argv[1:]

def tree(path, prefix=''):
    try:
        names = sorted(os.listdir(path), key=lambda n: (n.startswith('.'), n))
    except OSError as e:
        print(prefix + f'[unreadable: {e}]')
        return
    for i, name in enumerate(names):
        last = i == len(names) - 1
        branch = '`-- ' if last else '|-- '
        child = os.path.join(path, name)
        if os.path.islink(child):
            print(prefix + branch + name + ' -> ' + os.readlink(child))
            continue
        print(prefix + branch + name)
        if os.path.isdir(child):
            tree(child, prefix + ('    ' if last else '|   '))

print(root)
tree(root)
print(target)
tree(target)
PY
} >> "$MANIFEST"

echo "Fixture ready at $ROOT"
echo "Symlink target at $TARGET"
echo "Manifest at $MANIFEST"
