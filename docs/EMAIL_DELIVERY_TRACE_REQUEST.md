# University IT trace request (draft; not sent)

Subject: NW Student Planner verification emails delayed approximately one hour and delivered to Junk

Users report that NW Student Planner account-verification messages arrive in Junk
approximately one hour after being requested. Please trace one affected message
and identify where the delay occurs and why the Junk verdict was applied.

- Sender: `noreply@planner.chanakyachowdary.in`
- Recipient: [affected university address]
- Request time and timezone: [time]
- Observed arrival time and timezone: [time]
- Internet Message-ID: [from the message headers]

Please provide the receive, defer, filter, and delivery event times, any temporary
SMTP response or deferral reason, SPF/DKIM/DMARC and composite authentication
results, spam confidence level (SCL), filtering verdict (SFV/CAT), and any policy
or transport rule responsible. If this is a false positive, please review it for
correction and tell us which sender-side changes are required.

The Firebase custom sending domain is applied, and its expected SPF and DKIM DNS
records resolve. Firebase's email-action API accepted the requests in the observed
metrics window, but those API responses do not establish SMTP delivery timing.

Please omit the message body and verification URL/code from any shared diagnostic
export; the headers and trace are sufficient for the next investigation step.
