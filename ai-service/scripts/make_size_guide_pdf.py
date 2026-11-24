"""Generate knowledge/size-guide.pdf for ingestion tests.
Page 3 is deliberately image-only (no text layer) to test the 'scanned page' warning."""
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.platypus.flowables import Flowable

OUT = Path(__file__).resolve().parent.parent / "knowledge" / "size-guide.pdf"


class Scribble(Flowable):
    """Shapes only - simulates a scanned page with no extractable text."""
    def wrap(self, *a):
        return 400, 500

    def draw(self):
        c = self.canv
        c.setStrokeColor(colors.grey)
        for i in range(12):
            c.rect(20 + i * 8, 20 + i * 30, 300 - i * 10, 18, stroke=1, fill=0)


def table(rows):
    t = Table(rows, hAlign="LEFT")
    t.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                           ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E8E8F0")),
                           ("FONTSIZE", (0, 0), (-1, -1), 9)]))
    return t


def main():
    ss = getSampleStyleSheet()
    H1, H2, P = ss["Title"], ss["Heading2"], ss["BodyText"]
    s = [
        Paragraph("UnoCX Size Guide", H1),
        Paragraph("How to measure", H2),
        Paragraph("Chest: measure around the fullest part of your chest, keeping the tape horizontal. "
                  "Waist: measure around your natural waistline, the narrowest part of your torso. "
                  "Hips: measure around the fullest part of your hips. Use a soft measuring tape and "
                  "measure over light clothing.", P),
        Paragraph("Between two sizes? For tops and dresses, choose the larger size. For bottoms, choose the "
                  "size that matches your waist measurement. Our Relaxed Fit range is cut 5 cm looser than "
                  "Regular Fit, so choose your usual size or one size down for Relaxed Fit.", P),
        Paragraph("Women's tops and dresses (body measurements in cm)", H2),
        table([["Size", "Chest", "Waist", "Hips"], ["XS", "78-82", "62-66", "86-90"], ["S", "83-87", "67-71", "91-95"],
               ["M", "88-92", "72-76", "96-100"], ["L", "93-98", "77-82", "101-106"],
               ["XL", "99-104", "83-88", "107-112"], ["XXL", "105-110", "89-94", "113-118"]]),
        Spacer(1, 8),
        Paragraph("Women's tops sizes: XS fits chest 78-82 cm, S fits chest 83-87 cm, M fits chest 88-92 cm, "
                  "L fits chest 93-98 cm, XL fits chest 99-104 cm, XXL fits chest 105-110 cm.", P),
        PageBreak(),
        Paragraph("Men's shirts and t-shirts (body measurements in cm)", H2),
        table([["Size", "Chest", "Waist"], ["S", "91-96", "76-81"], ["M", "97-102", "82-87"],
               ["L", "103-108", "88-93"], ["XL", "109-114", "94-99"], ["XXL", "115-120", "100-105"]]),
        Spacer(1, 8),
        Paragraph("Men's shirt sizes: S fits chest 91-96 cm, M fits chest 97-102 cm, L fits chest 103-108 cm, "
                  "XL fits chest 109-114 cm, XXL fits chest 115-120 cm.", P),
        Paragraph("Shrinkage and fit after washing", H2),
        Paragraph("Our cotton garments are pre-shrunk. Expect less than 3% shrinkage when washed cold as per "
                  "the care label. Linen may soften and relax slightly after the first wash.", P),
        Paragraph("Kids sizes", H2),
        Paragraph("UnoCX does not currently make kidswear. Our sizes start at women's XS and men's S.", P),
        PageBreak(),
        Scribble(),
    ]
    SimpleDocTemplate(str(OUT), pagesize=A4, title="UnoCX Size Guide").build(s)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
