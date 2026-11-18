#!/usr/bin/env python3
"""Read-only Firebase email checks. Never sends mail or prints identities/tokens.

Usage: python3 scripts/diagnose-email-verification.py --project nw-student-planner
Requires existing gcloud authentication and dig. No additional Python packages.
"""
import argparse
import collections
import datetime as dt
import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', default='nw-student-planner')
    parser.add_argument('--days', type=int, choices=range(1, 31), default=30, metavar='1..30')
    args = parser.parse_args()
    token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True, stderr=subprocess.PIPE).strip()
    headers = {'Authorization': 'Bearer ' + token, 'x-goog-user-project': args.project}

    def get(path, query=None):
        # Credentials only go to the two fixed Google API hosts below.
        url = path + ('?' + urllib.parse.urlencode(query, doseq=True) if query else '')
        request = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(request, timeout=25) as response:
            return json.load(response)

    config = get(f'https://identitytoolkit.googleapis.com/admin/v2/projects/{args.project}/config', {
        'fields': 'authorizedDomains,notification(sendEmail(method,callbackUri,dnsInfo,verifyEmailTemplate(senderLocalPart,senderDisplayName)))',
    })
    send = config.get('notification', {}).get('sendEmail', {})
    dns = send.get('dnsInfo', {})
    domain = dns.get('customDomain') if dns.get('useCustomDomain') else None
    records = {}
    if domain:
        for record_type, name in [('TXT', domain), ('CNAME', 'firebase1._domainkey.' + domain), ('CNAME', 'firebase2._domainkey.' + domain)]:
            result = subprocess.run(['dig', '+time=3', '+tries=1', '+short', record_type, name], capture_output=True, text=True, timeout=10, check=True)
            records[name] = result.stdout.strip().splitlines()

    counts = collections.Counter()
    page = None
    while True:
        query = {'maxResults': 1000, 'fields': 'users(emailVerified),nextPageToken'}
        if page:
            query['nextPageToken'] = page
        batch = get(f'https://identitytoolkit.googleapis.com/v1/projects/{args.project}/accounts:batchGet', query)
        for user in batch.get('users', []):
            counts['verified' if user.get('emailVerified') else 'unverified'] += 1
        page = batch.get('nextPageToken')
        if not page:
            break

    end = dt.datetime.now(dt.timezone.utc)
    start = end - dt.timedelta(days=args.days)
    metrics = get(f'https://monitoring.googleapis.com/v3/projects/{args.project}/timeSeries', {
        'filter': 'metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.type="consumed_api" AND resource.labels.service="identitytoolkit.googleapis.com" AND resource.labels.method="google.cloud.identitytoolkit.v1.AccountManagementService.GetOobCode"',
        'interval.startTime': start.isoformat(), 'interval.endTime': end.isoformat(),
        'aggregation.alignmentPeriod': str(args.days * 86400) + 's',
        'aggregation.perSeriesAligner': 'ALIGN_SUM', 'aggregation.crossSeriesReducer': 'REDUCE_SUM',
        'aggregation.groupByFields': ['metric.labels.response_code'], 'view': 'FULL',
    })
    statuses = collections.Counter()
    for series in metrics.get('timeSeries', []):
        code = series.get('metric', {}).get('labels', {}).get('response_code', 'unknown')
        statuses[code] += sum(int(point['value'].get('int64Value', 0)) for point in series.get('points', []))
    print(json.dumps({
        'observedAt': end.isoformat(), 'project': args.project,
        'senderMethod': send.get('method'), 'customDomain': domain,
        'dnsInfo': dns, 'dnsRecords': records,
        'actionHandler': send.get('callbackUri'), 'authorizedDomains': config.get('authorizedDomains'),
        'accounts': dict(counts), 'emailActionRequestStatuses': dict(statuses), 'windowDays': args.days,
        'limits': [
            'HTTP 200 confirms API acceptance, not SMTP delivery or an inbox placement.',
            'Email action metrics include verification, resets, and operator link generation.',
            'NOT_STARTED describes a pending verification; customDomain is the applied verified domain.',
            'Mailbox headers or a recipient-side message trace are required to establish filtering.',
        ],
    }, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (urllib.error.URLError, subprocess.SubprocessError) as error:
        # Do not echo request bodies, tokens, gcloud identities, or full provider errors.
        raise SystemExit('Diagnostic failed: ' + type(error).__name__ + '. Check project access, authentication, and network.') from None
