# Blazorise Jobs

This repository collects job postings via GitHub Issue Forms and publishes a validated `jobs.json` feed for the Blazorise website.

## Submit a job
1. Open a new issue using the "Job posting" template.
2. Fill out the required fields. Jobs are moderated; only approved posts appear in the feed. Spam will be removed.
3. A maintainer reviews and labels the submission.

## Moderation labels
- `type:job` - Identifies issues that are job submissions.
- `status:pending` - Awaiting review (default on submission).
- `status:approved` - Approved and eligible for the feed.
- `status:rejected` - Rejected or spam (not included).

## Approval process
1. Review the submission.
2. Apply `status:approved` and remove `status:pending`.
3. Keep the issue open while it is active; closed issues are excluded from the feed.

## Expiry rules
- `expiryDate` is required in `YYYY-MM-DD` (UTC).
- Jobs with `expiryDate` earlier than today (UTC) are excluded.
- Only open issues are considered.

## Feed output
- Generated hourly and on issue activity.
- Includes only open issues labeled `type:job` + `status:approved`, and not expired.
- Published to GitHub Pages at `https://<org>.github.io/<repo>/jobs.json` once Pages is enabled.
- Schema lives at `schema/jobs.schema.json`.

## Refresh webhook
If the main site needs a refresh signal when the feed updates, set repository secrets:
- `JOBS_REFRESH_URL` - POST endpoint to notify.
- `JOBS_REFRESH_SECRET` - Sent as `X-Refresh-Secret` header.

If either secret is missing, the refresh call is skipped.

## Caching guidance
GitHub Pages sets standard cache headers. If you need aggressive cache control, place Pages behind a CDN or append a cache-busting query string when fetching the feed.
