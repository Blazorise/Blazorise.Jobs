# Contributing

Thanks for helping keep the Blazorise jobs feed clean and useful.

## Submit a job
- Use the "Job posting" issue form.
- Fill all required fields.
- Jobs are moderated; only approved posts appear in the feed.

## Moderation checklist
1. Confirm the posting is legitimate (company, role, and apply URL).
2. Ensure all required fields are present and valid.
3. Apply `status:approved` and remove `status:pending`.
4. Leave the issue open while the job is active.
5. If spam or invalid, apply `status:rejected` and close the issue.

## Expiry and removal
- Jobs with `expiryDate` earlier than today (UTC) are excluded automatically.
- Closing an issue removes it from the feed.

## Labels
- `type:job`
- `status:pending`
- `status:approved`
- `status:rejected`

## Troubleshooting
- If the workflow fails, check Actions logs for validation errors.
- Fix the issue body fields or remove `status:approved` until corrected.
