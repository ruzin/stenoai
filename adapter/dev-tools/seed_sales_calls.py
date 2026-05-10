#!/usr/bin/env python3
"""Seeds the org adapter with a handful of synthetic sales-call summaries for
"AI enablement of call centres". Uses Alice's account and the same
presign → PUT → register flow that the Steno desktop uses, so the resulting
notes are indistinguishable from real shared notes.

Run:
    cd adapter
    .venv/bin/python dev-tools/seed_sales_calls.py
"""
from __future__ import annotations

import json
import sys
import urllib.request


ADAPTER = "http://127.0.0.1:8000"
EMAIL = "alice@enam.co"
PASSWORD = "demo"


def post(path: str, body: dict, token: str | None = None) -> dict:
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        ADAPTER + path,
        data=data,
        method="POST",
        headers={"content-type": "application/json"},
    )
    if token:
        req.add_header("authorization", "Bearer " + token)
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())


def put_bytes(url: str, body: str, content_type: str = "text/markdown") -> None:
    req = urllib.request.Request(
        url,
        data=body.encode(),
        method="PUT",
        headers={"content-type": content_type},
    )
    with urllib.request.urlopen(req) as r:
        if r.status >= 300:
            raise RuntimeError(f"PUT failed: {r.status}")


# ---------------------------------------------------------------------------
# Synthetic notes — varied prospects, stages, and call types. All in the
# same markdown structure that composeShareBody produces in MeetingDetail.
# ---------------------------------------------------------------------------

NOTES = [
    {
        "title": "NorthBank Customer Care — Discovery Call",
        "body": """## Summary

Initial discovery call with NorthBank's contact centre leadership (VP Customer Operations, Head of Frontline, Director of Workforce Management). They run ~2,400 agents across three sites and are evaluating AI-assisted call summarisation and real-time agent assist. Their primary pain is average-handle-time creep and inconsistent QA scoring. They flagged regulated-data handling as the hard constraint — PII and account numbers must never leave their VPC.

## Key topics

### After-call wrap-up time
Agents currently spend ~110 seconds per call on disposition + notes. They believe a streamed summary at end-of-call could cut this in half if accuracy is high enough. They've trialled a competitor and found the summaries too generic to be usable.

### Real-time agent assist
Strong interest in next-best-action prompts during difficult calls (collections, fraud disputes). Concerned about agent overload — wants surfacing to be opt-in rather than constant.

### Data sovereignty
Hard requirement: no audio or transcripts to a third-party cloud. Their security team has approved on-prem and customer-VPC architectures previously. The mention of Steno's local-first model landed well.

## Key points

- Agent count: 2,400 across three sites (UK + two India)
- Current AHT: 6m 40s; wrap-up: ~110s
- Existing QA: manual sampling of 2% of calls
- They've trialled CompetitorX — failed on summary quality
- Security team requires no third-party cloud for call audio
- VP Ops is the economic buyer; Head of Frontline is the champion

## Action items

- Ruzin: send technical architecture brief covering customer-VPC deployment
- Ruzin: provide reference customers in regulated industries (banking or insurance)
- NorthBank (Priya): introduce InfoSec lead before any POC scoping
- NorthBank (Marcus): pull 20 representative call recordings (anonymised) for accuracy benchmark
- Joint: target POC scoping call in 10 business days
""",
    },
    {
        "title": "Helio Health Helpline — Pilot Scoping",
        "body": """## Summary

Working session with Helio Health to scope a 60-day pilot of agent-assist + auto-summary on their nurse triage line. Smaller than NorthBank — 180 nurses across two centres — but tighter compliance envelope (HIPAA-equivalent in their region) and a stronger appetite to move fast. Their CIO joined unexpectedly and pushed for a 90-day commercial decision window.

## Key topics

### Triage protocol adherence
Nurses follow a structured triage script. The team wants AI to highlight protocol deviations in real time so QA can intervene early. Concern: false positives on legitimate clinical judgement calls.

### Patient consent
Calls already carry a recording-consent disclosure. They want explicit language added for AI summarisation; their counsel will draft the wording within two weeks.

### Integration with their EMR
Summaries need to flow into their existing EMR (Epic) via HL7. Their integrations team has done similar work and estimates four weeks.

## Key points

- 180 nurses, two centres
- HIPAA-equivalent compliance required
- Existing recording infrastructure in place
- CIO sponsoring; clinical lead is technical evaluator
- Decision window: 90 days
- HL7 integration to Epic is in-scope for the pilot

## Action items

- Ruzin: send pilot SOW template by Wednesday
- Helio (legal): draft updated patient consent language
- Helio (integrations): scope HL7 connector spike — confirm 4-week estimate
- Joint: kickoff workshop set for the 22nd
- Ruzin: produce success-metrics doc (protocol adherence rate, summary acceptance rate, AHT delta)
""",
    },
    {
        "title": "RetailCo Support Center — Demo Recap",
        "body": """## Summary

Live demo with RetailCo's e-commerce support leadership. They run a seasonal-spiky operation — 600 agents in peak, 220 in trough. Pain points are seasonal ramp-time and knowledge-base sprawl. They saw the agent-assist suggestion flow and asked sharp questions about retrieval quality.

## Key topics

### Knowledge retrieval grounding
Their KB has 8,000 articles, many duplicated and contradictory. They were impressed that the retrieval surfaces canonical answers but want to understand how stale content is suppressed. Confidence-scored grounding would help their QA team.

### Seasonal agent ramp
They onboard ~400 seasonal agents in October. Today, time-to-productivity is 4 weeks. They want to compress that to 7 days using agent-assist as a training-wheel.

### Pricing
Pushback on per-seat pricing for seasonal staff. Asked for a peak/trough model. Open to a higher base if peak burst is unmetered.

## Key points

- 220 baseline + 380 seasonal agents
- KB: 8,000 articles, no version control
- Ramp time today: 4 weeks; target: 7 days
- Pricing model is the main commercial blocker
- Champion is Director of Service Ops; economic buyer is COO

## Action items

- Ruzin: send a peak/trough pricing proposal by Friday
- RetailCo (Sara): export KB metadata so we can quantify staleness
- Ruzin: case study on seasonal ramp acceleration (preferably DTC retail)
- Joint: COO intro meeting scheduled for next Tuesday
""",
    },
    {
        "title": "MutualPlus Insurance — Pricing Q&A",
        "body": """## Summary

Pricing Q&A with MutualPlus procurement following last week's technical workshop. Procurement is pushing for a fixed annual licence rather than usage-based pricing. The technical team is supportive but procurement holds the pen. They flagged that their incumbent (CompetitorY) gave a 30% discount last renewal and they expect a comparable starting point.

## Key topics

### Commercial model
They want predictability: fixed annual for unlimited usage, with a true-up at year-end if agent count grows beyond the band. Our current model is per-active-agent monthly. Gap is bridgeable but needs finance sign-off our side.

### Term length
3 years preferred — they will commit to multi-year for a price break. Wants a year-1 ramp clause given their phased rollout.

### Procurement timeline
RFP closes in 6 weeks. Technical scoring already complete; commercial scoring is the remaining gate.

## Key points

- Procurement-driven; technical evaluation favourable
- Incumbent at -30% on list price
- Want fixed annual + true-up rather than per-agent
- 3-year term acceptable for a price break
- RFP closes in 6 weeks

## Action items

- Ruzin: take fixed-annual proposal to finance for approval by Monday
- Ruzin: prepare 3-year pricing with year-1 ramp scenario
- MutualPlus (procurement lead): share the commercial scoring rubric
- Joint: pricing presentation scheduled for the 18th
""",
    },
    {
        "title": "FintechFlux Card Services — Technical Deep-Dive",
        "body": """## Summary

Two-hour technical deep-dive with FintechFlux's engineering and InfoSec teams on the call-centre deployment architecture. They run a card-services contact centre handling fraud disputes and chargebacks — high-stakes, tightly regulated. Their CISO was pragmatic and constructive; key concerns were around model auditability and customer-data lineage rather than the AI itself.

## Key topics

### Audit trail
Every model invocation needs to be auditable — what was the prompt, what was the response, what was the agent action. They want six-month immutable retention of metadata (not transcripts) for regulator queries. Steno's current logging covers most of this; gap is around the prompt-template versioning.

### Data minimisation
They want PII redaction before the model sees the transcript. We currently rely on the customer's redaction pipeline. They asked if we could ship a built-in redaction step — investigate.

### Model updates
CISO does not want silent model updates. Wants a pinned model version with a change-management gate before any major upgrade.

## Key points

- Card services contact centre, fraud/chargeback workflows
- Six-month immutable audit metadata required
- PII redaction must happen before model invocation
- No silent model updates — pinned versions with change-mgmt
- CISO will be a co-signer on the contract

## Action items

- Ruzin: write up audit-trail spec; confirm six-month retention is in scope for the default tier
- Engineering (internal): scope built-in redaction primitive; cost estimate
- FintechFlux (Ravi): share their current redaction taxonomy
- Joint: follow-up on model-versioning policy in 2 weeks
""",
    },
    {
        "title": "PowerGrid Utilities — POC Walkthrough",
        "body": """## Summary

POC walkthrough at end of week 4 of an 8-week trial with PowerGrid Utilities. Operations are pleased — measured AHT reduction of 18% on the pilot team of 40 agents — but executive sponsor (SVP Customer Ops) raised three concerns that need to land before they greenlight rollout. Felt productive; champion is fighting our corner internally.

## Key topics

### Pilot metrics
AHT down 18%, summary acceptance rate 92%, agent CSAT on the tool +1.2 points. Numbers are credible — pilot manager has been rigorous about controls. Executive wants to see this sustained for the remaining four weeks before committing.

### Change management at scale
SVP is worried about rolling from 40 to 1,800 agents without a phased plan. Wants a documented rollout cohort plan with abort criteria.

### Integration with their WFM
Their workforce-management tool (Verint) needs to ingest the summary completion event. The integration exists but they want our SE to confirm it's been deployed elsewhere at this scale.

## Key points

- Pilot AHT reduction: 18%
- Summary acceptance rate: 92%
- Agent CSAT: +1.2 points
- 40 → 1,800 agent rollout needs documented phasing
- Verint integration must be production-validated at similar scale
- 4 weeks remaining in the pilot

## Action items

- Ruzin: send rollout cohort plan template by Tuesday
- Ruzin: arrange call with reference customer at similar agent count
- Solutions Engineer: produce a deployment-at-scale brief for Verint integration
- PowerGrid (champion): keep the SVP regularly briefed on pilot metrics — weekly cadence
- Joint: end-of-pilot review scheduled for the 28th
""",
    },
]


def main():
    print("logging in as", EMAIL)
    login = post("/auth/login", {"email": EMAIL, "password": PASSWORD})
    token = login["token"]
    print("token ok")

    for note in NOTES:
        title = note["title"]
        body = note["body"]

        # 1. presign
        safe = title.lower().replace(" ", "-").replace("—", "-")
        safe = "".join(c for c in safe if c.isalnum() or c in "-")[:60].strip("-")
        presign = post(
            "/uploads/presign",
            {"filename": f"{safe}.md", "content_type": "text/markdown"},
            token=token,
        )

        # 2. PUT to S3
        put_bytes(presign["upload_url"], body)

        # 3. register
        meeting = post(
            "/meetings",
            {"title": title, "body": "", "visibility": "org", "s3_key": presign["s3_key"]},
            token=token,
        )
        print(f"  + {meeting['id']:14} {title} ({len(body)} chars)")

    print("done — re-check the Shared notes view in Steno.")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as e:
        print("HTTP error:", e.code, e.read().decode()[:200], file=sys.stderr)
        sys.exit(1)
