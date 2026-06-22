# Workspace Release Rules

- **CI/CD Build & Release**: This repository uses a GitHub Actions workflow defined in `.github/workflows/release.yml` to automatically build the Windows installer (`.exe`) using `electron-builder` and release it.
- **Workflow Triggers**: The release workflow is automatically triggered when a Git tag starting with `v` (e.g., `v1.0.0`) is pushed to the repository.
- **Agent Instructions**:
  - When the user asks to release, publish, or build a new version, the agent should first advise updating the `"version"` field in `package.json` to match the tag.
  - Inform the user to create and push a Git tag (e.g., `git tag v1.0.1` and `git push origin v1.0.1`) to trigger the build and release on GitHub.
  - Direct the user to reference [RELEASE.md](file:///c:/Users/user/Desktop/test_html/patches/RELEASE.md) for step-by-step instructions.
