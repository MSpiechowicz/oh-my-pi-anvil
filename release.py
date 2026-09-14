"""Plan releases by default; --push opts into mutations in a disposable checkout."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.request

VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
CATALOG = ".omp-plugin/marketplace.json"
EXTENSION = "extension.js"
PLUGIN = "oh-my-pi-anvil"


def bump_version(version, bump):
    match = VERSION.fullmatch(version)
    if match is None:
        raise ValueError("package.json version must be stable MAJOR.MINOR.PATCH")
    major, minor, patch = map(int, match.groups())
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    if bump == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise ValueError("Unknown version bump")


def git(repo, *args):
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90,
    ).stdout.rstrip("\n")


def catalog_for(repo, source, current_version, version):
    catalog = json.loads(git(repo, "show", f"{source}:{CATALOG}"))
    plugins = [plugin for plugin in catalog["plugins"] if plugin["name"] == PLUGIN]
    if len(plugins) != 1:
        raise ValueError("Marketplace must contain exactly one Anvil plugin")
    plugin = plugins[0]
    if plugin["version"] != current_version or plugin["source"]["ref"] != f"v{current_version}":
        raise ValueError("Marketplace version and ref must match package.json")
    plugin["version"] = version
    plugin["source"]["ref"] = f"v{version}"
    return catalog


def plan_release(repo, source, bump="patch", push=False):
    repo = Path(repo).resolve()
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Source must be a full commit SHA")
    if not (repo / EXTENSION).is_file():
        raise ValueError(f"Required root extension artifact {EXTENSION} is missing")
    dirty_paths = [line[3:] for line in git(repo, "status", "--porcelain", "--untracked-files=all").splitlines()]
    if any(path != EXTENSION for path in dirty_paths):
        raise ValueError("Release checkout must be clean")
    if git(repo, "rev-parse", "HEAD") != source:
        raise ValueError("Release checkout must be at the workflow source SHA")
    git(repo, "fetch", "--no-recurse-submodules", "origin", "+refs/heads/main:refs/remotes/origin/main", "refs/tags/*:refs/tags/*")
    remote_head = git(repo, "rev-parse", "refs/remotes/origin/main")
    metadata = json.loads(git(repo, "show", f"{source}:package.json"))
    version = bump_version(metadata["version"], bump)
    catalog = catalog_for(repo, source, metadata["version"], version)
    tag = f"v{version}"
    message = f"chore(release): {tag}\n\nRelease-Source: {source}\nRelease-Bump: {bump}"
    tags = git(repo, "tag", "--list", tag).splitlines()
    if tags:
        commit = git(repo, "rev-parse", f"refs/tags/{tag}^{{commit}}")
        parents = git(repo, "show", "-s", "--format=%P", commit)
        released = json.loads(git(repo, "show", f"{commit}:package.json"))
        released_extension = git(repo, "show", f"{commit}:{EXTENSION}")
        matching = (
            parents == source
            and git(repo, "show", "-s", "--format=%B", commit) == message
            and git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", commit).splitlines() in ([CATALOG, "package.json"], [CATALOG, EXTENSION, "package.json"])
            and released == dict(metadata, version=version)
            and json.loads(git(repo, "show", f"{commit}:{CATALOG}")) == catalog
            and released_extension == (repo / EXTENSION).read_text(encoding="utf-8").strip()
        )
        if not matching:
            raise ValueError(f"Tag {tag} already exists and is not this release")
        if remote_head != commit:
            return {"skipped": True, "reason": "main advanced after this release; stale run"}
        return {"skipped": False, "version": version, "tag": tag, "commit": commit, "reused": True}
    if remote_head != source:
        return {"skipped": True, "reason": "main advanced; stale run"}
    for existing in git(repo, "tag", "--list", "v*").splitlines():
        match = VERSION.fullmatch(existing[1:])
        if match and tuple(map(int, match.groups())) >= tuple(map(int, version.split("."))):
            raise ValueError(f"New version {version} must exceed existing tag {existing}")
    result = {"skipped": False, "version": version, "tag": tag, "reused": False}
    if not push:
        return result
    package = repo / "package.json"
    text = package.read_text(encoding="utf-8")
    updated, count = re.subn(r'("version"\s*:\s*")' + re.escape(metadata["version"]) + r'(")', lambda match: match[1] + version + match[2], text)
    if count != 1:
        raise ValueError("package.json must contain exactly one version field")
    package.write_text(updated, encoding="utf-8")
    (repo / CATALOG).write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    git(repo, "add", "--", "package.json", CATALOG, EXTENSION)
    git(repo, "-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "-c", "commit.gpgsign=false", "commit", "-m", message)
    commit = git(repo, "rev-parse", "HEAD")
    git(repo, "-c", "tag.gpgsign=false", "tag", tag, commit)
    git(repo, "push", "--atomic", "origin", f"{commit}:refs/heads/main", f"refs/tags/{tag}:refs/tags/{tag}")
    result["commit"] = commit
    return result


def publish_release(repository, tag):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Repository must be owner/name")
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise ValueError("GITHUB_TOKEN is required to publish a GitHub Release")
    base = f"https://api.github.com/repos/{repository}/releases"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "oh-my-pi-anvil-release"}
    request = urllib.request.Request(f"{base}/tags/{tag}", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            existing = json.load(response)
        if existing["draft"] or existing["prerelease"]:
            raise ValueError(f"{tag} already has a draft or prerelease; resolve it manually")
        return existing["html_url"]
    except urllib.error.HTTPError as error:
        error.close()
        if error.code != 404:
            raise ValueError(f"GitHub release lookup failed (HTTP {error.code})") from None
    payload = json.dumps({"tag_name": tag, "name": tag, "draft": False, "prerelease": False, "generate_release_notes": True, "make_latest": "legacy"}).encode("utf-8")
    request = urllib.request.Request(base, data=payload, headers=dict(headers, **{"Content-Type": "application/json"}), method="POST")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)["html_url"]
    except urllib.error.HTTPError as error:
        error.close()
        raise ValueError(f"GitHub release creation failed (HTTP {error.code}); rerun the workflow to resume") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--source", required=True)
    parser.add_argument("--bump", choices=("patch", "minor", "major"), default="patch")
    parser.add_argument("--push", action="store_true")
    parser.add_argument("--github-release", action="store_true")
    parser.add_argument("--repository", default=os.environ.get("GITHUB_REPOSITORY", ""))
    args = parser.parse_args()
    if args.github_release and (not args.push or not args.repository):
        parser.error("--github-release requires --push and --repository (or GITHUB_REPOSITORY)")
    try:
        result = plan_release(args.repo, args.source, args.bump, args.push)
        if args.github_release and not result["skipped"]:
            result["releaseUrl"] = publish_release(args.repository, result["tag"])
        print(json.dumps(result))
        return 0
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        if isinstance(error, subprocess.CalledProcessError):
            text = f"Git command failed (exit {error.returncode}); check branch/tag rules and whether main advanced"
        elif isinstance(error, subprocess.TimeoutExpired):
            text = "Git command timed out; rerun in a fresh checkout"
        else:
            text = str(error)
        print(f"Release failed: {text}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
