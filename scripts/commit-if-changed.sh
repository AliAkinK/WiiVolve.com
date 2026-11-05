#!/usr/bin/env bash
# Commits the builder's outputs and pushes them. Used by .github/workflows/site.yml after
# `node scripts/build-news.mjs` reported changed=true.
#
#   bash scripts/commit-if-changed.sh
#
# Stages exactly the six generated files (never anything else under site/ or state/), commits as
# github-actions[bot] when anything differs, then rebases onto the remote branch and pushes, up to 3
# attempts. Writes to $GITHUB_OUTPUT (when set):
#   result=unchanged   nothing to commit
#   result=pushed      the commit is on the remote branch (also sha=<commit>)
#   result=conflict    the branch moved and the new commits change the same generated files; this
#                      run's outputs are dropped, because that newer commit has its own run, which
#                      rebuilds and deploys
#   superseded=true    the rebase brought in a newer push that changes other files (code, CSS, feeds.json):
#                      this run's page was built from the old ones, so the workflow skips its deploy and
#                      the run for that push deploys a consistent build
# Exits 1 when fetching or pushing keeps failing (branch protection, missing contents: write) or when the
# checkout is not on a branch.
#
# Optional environment: SUMMARY (one line for the commit message), BRANCH, REMOTE.
set -euo pipefail

GENERATED=(site/index.html site/news.json site/feed.xml site/feed.json site/health.json state/state.json)

BRANCH="${BRANCH:-${GITHUB_REF_NAME:-$(git symbolic-ref --short -q HEAD || true)}}"
if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
  echo "::error title=Not on a branch::The checkout is a detached HEAD, so there is no branch to push to. Check out a branch (site.yml checks out github.ref_name)."
  exit 1
fi
REMOTE="${REMOTE:-origin}"
SUMMARY="${SUMMARY:-hourly refresh}"
MESSAGE="Update news: ${SUMMARY:0:100}"

out() {
  echo "$1"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1" >> "$GITHUB_OUTPUT"; fi
}

rebase_in_progress() {
  [ -d "$(git rev-parse --git-path rebase-merge)" ] || [ -d "$(git rev-parse --git-path rebase-apply)" ]
}

# Environment variables win over git config, so the bot identity holds whatever the runner sets.
export GIT_AUTHOR_NAME="github-actions[bot]"
export GIT_AUTHOR_EMAIL="41898282+github-actions[bot]@users.noreply.github.com"
export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME"
export GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"

paths=()
for p in "${GENERATED[@]}"; do
  if [ -e "$p" ] || git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; then paths+=("$p"); fi
done
if [ "${#paths[@]}" -eq 0 ]; then
  out "result=unchanged"
  exit 0
fi

git add -A -- "${paths[@]}"
if git diff --cached --quiet; then
  echo "Nothing to commit."
  out "result=unchanged"
  exit 0
fi
base="$(git rev-parse HEAD)"
git commit --quiet -m "$MESSAGE"
echo "Committed: $MESSAGE"

for attempt in 1 2 3; do
  # --autostash: a stray change to some other tracked file must not block the rebase.
  if git pull --rebase --autostash --quiet "$REMOTE" "$BRANCH"; then
    if git push --quiet "$REMOTE" "HEAD:$BRANCH"; then
      out "result=pushed"
      out "sha=$(git rev-parse HEAD)"
      # Files the rebase brought in from newer commits, other than the generated ones.
      newer="$(git diff --name-only "$base" HEAD~1 -- . "${GENERATED[@]/#/:(exclude)}")"
      if [ -n "$newer" ]; then
        echo "::notice title=Deploy left to the newer run::$BRANCH moved during this run (${newer//$'\n'/, }). This run's page was built from the older files, so the run for the newer push deploys instead."
        out "superseded=true"
      fi
      exit 0
    fi
    echo "Push attempt $attempt of 3 was rejected."
  elif rebase_in_progress; then
    git rebase --abort
    echo "::warning title=Commit dropped::$BRANCH moved during this run and the new commits change the same generated files. This run's outputs were dropped; the run for the newer commit rebuilds and deploys the site."
    out "result=conflict"
    exit 0
  else
    echo "Fetching $REMOTE/$BRANCH failed (attempt $attempt of 3)."
  fi
  if [ "$attempt" -lt 3 ]; then sleep $((attempt * 5)); fi
done

echo "::error title=Push failed::Could not push to $BRANCH after 3 attempts. Check branch protection rules and that the job has contents: write (docs/RUNBOOK.md, Troubleshooting)."
exit 1
