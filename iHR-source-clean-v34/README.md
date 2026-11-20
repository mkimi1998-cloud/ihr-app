# iHR (rebuilt source)

Endpoints, base URL and field names were recovered from the string table of the original
iHR 1.0.2 Hermes bundle. Request/response shapes are inferred - confirm in `src/api.js`.

Build the APK: push to GitHub, run Actions > "Build iHR APK", download the `iHR-apk` artifact.

Not included yet: push-token registration (`api/fcm_store_token`) and `api/reference`.
To update the installed app in place, sign with the same keystore as the original.

## Side-by-side install
This build uses package `my.gov.mtib.ihr.v2` and the name "iHR 2", so it installs next to the
original `my.gov.mtib.ihr` instead of replacing it. Storage is separate: register again on first launch.
(Because the package differs, this build can never update the old app in place.)
