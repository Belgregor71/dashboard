# Calendar Upgrades Manual Test Steps

- Open Calendar view with no all-day events and confirm the month grid still renders normally.
- Verify all-day events appear in the top strip (`.day-allday-strip`) banners.
- Verify multi-day all-day events show continuation styles (`cont-start`, `cont-mid`, `cont-end`).
- Trigger `dashboard_command` = `show_details` and confirm details popover opens for focused/next event.
- Trigger `dashboard_command` = `close_details` and confirm popover closes.
- Trigger `next_month`, `previous_month`, and `go_today` commands and verify month title/events update.
- Confirm holidays are visible for QLD and styled with holiday banner treatment.
- Disable network and verify calendar still renders without runtime errors (holidays endpoint should gracefully fallback/empty).
- Validate in kiosk Chromium on Pi that no hover-only interaction is required for details card.
