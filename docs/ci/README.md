# CI workflow (not active here)

GitHub did not accept .github/workflows/android.yml in the initial push because the
automation token used for the upload has no `workflow` scope. The workflow itself is
preserved here as `android-workflow.yml` and is identical to the file in the
DeepSeek Harness plugin repository.

To enable CI in this repository:

1. Create the directory `.github/workflows/`.
2. Copy `docs/ci/android-workflow.yml` to `.github/workflows/android.yml`.
3. Commit and push with a token/account that has the `workflow` scope (or use the web UI).

The workflow builds `app-debug.apk` and `app-release-unsigned.apk` on ubuntu-latest
with JDK 17, Android SDK 35 and Gradle 8.9, and uploads them as the `dsh-mobile-apk` artifact.
