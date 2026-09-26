"use client";
import { useEffect, useState } from "react";
import { Button, Card, Input, PageHeader, Select } from "@vidya/ui-system";
import { api, ApiError } from "./api";
import { HelpButton } from "./help/HelpButton";

type Family = "report_card" | "attendance_review" | "certificate";
type Style = { schoolName: string; accentColor: string; footerText: string };
type Format = { family: string; version: number; style: Style; sample: { filename: string; contentType: string } | null };
const families: { value: Family; label: string }[] = [
  { value: "report_card", label: "Report cards" },
  { value: "attendance_review", label: "Attendance review" },
  { value: "certificate", label: "Certificates" },
];

async function sampleBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function sampleContentType(file: File): "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document" | null {
  if (file.type === "application/pdf" || (!file.type && file.name.toLowerCase().endsWith(".pdf"))) return "application/pdf";
  if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || (!file.type && file.name.toLowerCase().endsWith(".docx"))) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return null;
}

export function SchoolPoliciesPage() {
  const [colleges, setColleges] = useState<{ id: string; name: string }[]>([]);
  const [collegeId, setCollegeId] = useState("");
  const [family, setFamily] = useState<Family>("report_card");
  const [format, setFormat] = useState<Format | null>(null);
  const [style, setStyle] = useState<Style>({ schoolName: "", accentColor: "#b23a2e", footerText: "" });
  const [sample, setSample] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.colleges().then(({ colleges: found }) => {
      setColleges(found);
      setCollegeId((id) => id || found[0]?.id || "");
    }).catch(() => setError("Could not load schools."));
  }, []);
  useEffect(() => {
    if (!collegeId) return;
    let active = true;
    setFormat(null); setSample(null); setError(""); setMessage("");
    api.schoolDocumentFormat(collegeId, family).then((found) => {
      if (active) { setFormat(found); setStyle(found.style); }
    }).catch((caught: unknown) => {
      if (active) setError(caught instanceof ApiError && caught.status === 403 ? "Only a school administrator can edit document formats." : "Could not load this format.");
    });
    return () => { active = false; };
  }, [collegeId, family]);

  async function save() {
    if (!format || !collegeId) return;
    setError(""); setMessage("");
    if (sample && (sample.size > 1_048_576 || !sampleContentType(sample))) {
      setError("Choose a PDF or DOCX sample no larger than 1 MB."); return;
    }
    setBusy(true);
    try {
      const updated = await api.saveSchoolDocumentFormat(collegeId, family, {
        expectedVersion: format.version, style,
        ...(sample ? { sample: { filename: sample.name,
          contentType: sampleContentType(sample)!,
          dataBase64: await sampleBase64(sample) } } : {}),
      });
      setFormat(updated); setStyle(updated.style); setSample(null);
      setMessage(`Saved version ${updated.version}. New documents use this format; issued documents keep their original format.`);
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409 ? "This format changed elsewhere. Reload before saving." :
        caught instanceof ApiError ? caught.message : "Could not save this format.");
    } finally { setBusy(false); }
  }

  return <div style={{ maxWidth: 820 }}>
    <PageHeader eyebrow="School administration" title="Document formats" lede="Set the school name, accent and footer for generated PDFs. Upload a PDF or DOCX sample for reference; the sample does not change the generated layout. Verified record values stay fixed." help={<HelpButton slug="school-policies" />} />
    <Card title="School PDF appearance">
      <div style={{ display: "grid", gap: 16 }}>
        <Select label="School" value={collegeId} onChange={(event) => setCollegeId(event.target.value)} options={colleges.map((school) => ({ value: school.id, label: school.name }))} />
        <Select label="Document type" value={family} onChange={(event) => setFamily(event.target.value as Family)} options={families} />
        {format && <>
          {family === "certificate" && <p>Certificate issuance is being built. You can save its school style now.</p>}
          <Input label="School name" value={style.schoolName} maxLength={100} onChange={(event) => setStyle({ ...style, schoolName: event.target.value })} />
          <Input label="Accent colour" type="color" value={style.accentColor} style={{ width: 112, height: 48, padding: 4, cursor: "pointer" }} onChange={(event) => setStyle({ ...style, accentColor: event.target.value })} />
          <Input label="Footer text" value={style.footerText} maxLength={180} onChange={(event) => setStyle({ ...style, footerText: event.target.value })} />
          <div role="img" aria-label="Format preview" style={{ border: "1px solid #d6cfbc", padding: 22, borderTop: `5px solid ${style.accentColor}`, background: "white" }}>
            <strong style={{ color: style.accentColor, letterSpacing: 2, overflowWrap: "anywhere" }}>{style.schoolName || "School name"}</strong>
            <p style={{ fontSize: 20, margin: "14px 0" }}>{families.find((item) => item.value === family)?.label}</p>
            <p style={{ color: "#565c68", fontSize: 12 }}>Document values come from school records.</p>
            {style.footerText && <small>{style.footerText}</small>}
          </div>
          <Input label="Sample PDF or DOCX (reference only)" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => setSample(event.target.files?.[0] ?? null)} />
          {format.sample && <a href={api.schoolDocumentFormatSampleUrl(collegeId, family)}>Download current sample: {format.sample.filename}</a>}
          <Button onClick={() => void save()} loading={busy} disabled={!style.schoolName.trim()}>Save format</Button>
        </>}
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
    </Card>
  </div>;
}
