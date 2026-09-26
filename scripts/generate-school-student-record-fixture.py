from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor

out = Path('docs/demo/fixtures/fictional-student-record.pdf')
out.parent.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(out), pagesize=(595, 842))
c.setTitle('Fictional student record - demo import test')
c.setAuthor('Vidya synthetic demo')
c.setFillColor(HexColor('#1e2945'))
c.rect(0, 775, 595, 67, fill=1, stroke=0)
c.setFillColorRGB(1, 1, 1)
c.setFont('Helvetica-Bold', 20)
c.drawString(44, 802, 'STUDENT RECORD')
c.setFont('Helvetica', 10)
c.drawRightString(550, 806, 'FICTIONAL DEMO DATA')
c.setFillColor(HexColor('#a6b1c6'))
c.setFont('Helvetica-Bold', 62)
c.saveState()
c.translate(85, 360)
c.rotate(35)
c.drawString(0, 0, 'SAMPLE ONLY')
c.restoreState()
c.setFillColor(HexColor('#1e2945'))
c.setFont('Helvetica-Bold', 17)
c.drawString(44, 730, 'Meera Das')
c.setFont('Helvetica', 10)
c.setFillColor(HexColor('#586477'))
c.drawString(44, 710, 'Generated for the local Vidya school ERP import check')

fields = [
    ('Admission number', 'VDEMO-8A-003'),
    ('Academic year', '2026-27'),
    ('Class and section', 'Standard 8 - Section A'),
    ('Date of birth', 'Not recorded in demo'),
    ('Enrollment date', '1 April 2026'),
    ('Guardian', 'Not recorded in demo'),
    ('Guardian contact', 'Not recorded in demo'),
    ('Record status', 'Active'),
]
y = 660
for label, value in fields:
    c.setStrokeColor(HexColor('#e2e6ee'))
    c.line(44, y - 13, 550, y - 13)
    c.setFillColor(HexColor('#586477'))
    c.setFont('Helvetica', 10)
    c.drawString(44, y, label)
    c.setFillColor(HexColor('#1e2945'))
    c.setFont('Helvetica-Bold', 11)
    c.drawString(225, y, value)
    y -= 45

c.setFillColor(HexColor('#f0f3f9'))
c.roundRect(44, 137, 506, 102, 8, fill=1, stroke=0)
c.setFillColor(HexColor('#1e2945'))
c.setFont('Helvetica-Bold', 11)
c.drawString(60, 214, 'Purpose of this file')
c.setFont('Helvetica', 10)
c.drawString(60, 193, 'Test the bulk student importer and the student document attachment flow.')
c.drawString(60, 174, 'All names, identifiers and contact details are invented for this test.')
c.drawString(60, 155, 'This is not an official school record or a valid identity document.')
c.setFont('Helvetica', 9)
c.setFillColor(HexColor('#586477'))
c.drawString(44, 55, 'VIDYA LOCAL DEMO  /  SYNTHETIC FIXTURE')
c.drawRightString(550, 55, 'Page 1 of 1')
c.showPage()
c.save()
print(out.resolve())
