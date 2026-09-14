import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


RELEASE_SCRIPT = Path(__file__).resolve().parents[1] / "release.py"


class ReleaseCliTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="anvil-release-")
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.remote = root / "remote.git"
        self.repo = root / "checkout"
        self.repo.mkdir()
        self.git("init", "--bare", str(self.remote))
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Release test")
        self.git("config", "user.email", "release-test@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.git("config", "core.hooksPath", str(root / "no-hooks"))
        self.git("remote", "add", "origin", str(self.remote))
        (self.repo / ".omp-plugin").mkdir()
        (self.repo / "package.json").write_text(json.dumps({"name": "test", "version": "1.0.0"}) + "\n", encoding="utf-8")
        (self.repo / ".omp-plugin/marketplace.json").write_text(json.dumps({"plugins": [
            {"name": "oh-my-pi-anvil", "version": "1.0.0", "source": {"ref": "v1.0.0"}}
        ]}) + "\n", encoding="utf-8")
        (self.repo / "extension.js").write_text("export default 'original';\n", encoding="utf-8")
        (self.repo / "source.ts").write_text("export const value = 1;\n", encoding="utf-8")
        self.git("add", ".")
        self.git("commit", "-m", "Initial source")
        self.source = self.git("rev-parse", "HEAD").strip()
        self.git("push", "origin", "main")

    def git(self, *args):
        return subprocess.run(
            ["git", "-C", str(self.repo), *args], check=True, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
        ).stdout

    def release(self):
        return subprocess.run(
            [sys.executable, str(RELEASE_SCRIPT), "--repo", str(self.repo), "--source", self.source, "--push"],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
        )

    def test_publishes_rebuilt_extension_and_resumes_same_release(self):
        rebuilt = "export default 'rebuilt in CI';\n"
        (self.repo / "extension.js").write_text(rebuilt, encoding="utf-8")
        result = self.release()
        self.assertEqual(result.returncode, 0, result.stderr)
        published = json.loads(result.stdout)
        self.assertEqual(published["tag"], "v1.0.1")
        self.assertEqual(self.git("show", "v1.0.1:extension.js"), rebuilt)
        self.assertIn(published["commit"], self.git("ls-remote", "origin", "refs/heads/main"))
        self.assertIn(published["commit"], self.git("ls-remote", "origin", "refs/tags/v1.0.1"))

        # A rerun checks out the tested source, then rebuilds the same artifact.
        self.git("checkout", "--detach", self.source)
        (self.repo / "extension.js").write_text(rebuilt, encoding="utf-8")
        resumed = self.release()
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertTrue(json.loads(resumed.stdout)["reused"])
        self.assertEqual(json.loads(resumed.stdout)["commit"], published["commit"])

    def test_refuses_unrelated_source_changes_without_publishing(self):
        (self.repo / "source.ts").write_text("export const value = 2;\n", encoding="utf-8")
        result = self.release()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(self.source, self.git("ls-remote", "origin", "refs/heads/main"))
        self.assertEqual(self.git("ls-remote", "origin", "refs/tags/*"), "")


if __name__ == "__main__":
    unittest.main()
