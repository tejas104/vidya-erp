# School implementation decisions — 26 September 2026

The owner answered the implementation questionnaire for the next school-first
slices. These are product choices, not a claim that each feature is built or
that a real school has accepted it. Keep all development local until the owner
authorizes a push, merge, deployment or publication.

## N6: pupil exits

| Topic | Decision |
| --- | --- |
| One-pupil outcomes | Transfer out and graduation. |
| Leaving date | Today only. Scheduling and past-dated one-pupil exits wait for a separate reviewed workflow. |
| Reason | Required for every exit. |
| Entry point | Promotion and exits page. |
| Guardian history | Use the school's existing setting; no per-pupil override. |
| Pending invitations | Revoke on exit. |
| Correction | Use the existing audited one-pupil correction and its safety checks. |
| Open terms | Warn and allow the administrator to proceed. |
| Unpaid invoices | The school will decide its follow-up policy; previously issued invoices remain payable after exit. |

## N7: certificates and report formats

| Topic | Decision |
| --- | --- |
| Transfer certificate source | Use a recorded transfer by default; allow an explicitly audited manual exception. |
| Bonafide eligibility | Any pupil record. |
| Numbering | Per school and academic year. |
| Reissue and correction | Do not reissue the same certificate number. A corrected issuance should link to the prior one and keep both versions visible. |
| Issuers and signatories | Administrator or principal may issue; show both school signatory roles. |
| Language | English first, with a Hindi option for the pilot. |
| Verification | Include local-demo verification by number or QR, exposing only the minimum authenticity result. Public hosting and privacy review remain later gates. |
| Transfer certificate fields | Identity, enrollment, leaving date and reason; no optional fields in the first version. |
| Fee clearance | Separate clearance letter; each school may choose whether clearance blocks transfer-certificate issue. |
| School-specific format | Apply to report cards, certificates and attendance reports. Allow a school to upload a sample PDF or DOCX and to edit a controlled template in Vidya. Generated values must come from verified records. |

The first local format editor now offers school name, accent and footer for
report cards and attendance PDFs, with an uploaded sample as a private human
reference. Certificate styling is stored for the later certificate renderer.
Arbitrary layout mapping and automatic sample conversion are still open.

A pure N7 renderer now produces an English transfer or bonafide PDF from a
versioned, frozen certificate snapshot. The local `pnpm
preview:school-certificate` command writes one explicitly fictional PDF under
`output/pdf/` for layout review. It does not issue a certificate from a pupil
record, allocate a school/year number, approve an exception, create an audit
event, or make number/QR verification available. Those are the next N7 service
and database steps. Hindi text needs a packaged, licensed font and layout
proof before the pilot option can be enabled.

## N5: attendance escalation

Use the term's existing threshold. Escalate missing registers to staff before
considering a family shortfall message. Send the first internal alert to the
class teacher through an in-app queue. Review unresolved cases monthly and
start with a simple resolved flag; SMS and email delivery wait for a provider
decision.

## Admissions and pilot

Start with direct enrollment of accepted pupils. Require the two identifiers
selected by the owner in the questionnaire; their exact field names need to be
fixed in the admissions data contract before schema work. Make guardian
invitation available after acceptance, block possible duplicates for
administrator review, and wait for a retention and consent policy before
document uploads.

Plan the first real-school pilot for a CBSE whole school with full-history
import. Both administrator and principal approve progression and exit records
before certificates. The first school-user acceptance gate is fees and reports.
This requires actual school participation and data governance; it is not
satisfied by the fictional local demo.

## Experience and school policies

Polish Student 360 next, for both desktop and Android phone widths. Keep
English primary and offer Hindi where family help and certificates need it.
Move growing school settings to a dedicated administrator-editable policy page.

## Hosted vendor licensing (owner answers 2026-09-26)

Use a separate Vidya operator console. Only named Vidya operators with MFA may
manage multiple school tenants; a school administrator account has no vendor
authority. Keep the commercial price and plan model undecided until owner
review. A hosted school receives 30 calendar days of full access after its
paid-through date, then read-only access. Existing reports, receipts,
certificates and full data export stay available. Expiry never deletes school
data. The operator identity provider is still an open selection.
