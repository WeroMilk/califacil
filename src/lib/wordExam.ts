import type { ExamWithQuestions, Question } from '@/types';
import { chunkQuestions } from '@/lib/printExam';

const FONT = 'Times New Roman';
/** Medios puntos (docx): N pt → 2N */
const SZ_BODY = 18;
const SZ_Q = 17;
const SZ_SMALL = 16;
const SZ_TITLE = 20;
const SZ_RANGE = 18;
const SZ_FOOTER = 13;

type Docx = typeof import('docx');
type FileChild = import('docx').FileChild;

function addQuestionContent(docx: Docx, children: FileChild[], q: Question, index: number): void {
  const {
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    BorderStyle,
  } = docx;

  const noBorder = {
    top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  } as const;

  children.push(
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 20, line: 276 },
      children: [
        new TextRun({ text: `${index + 1}. `, bold: true, font: FONT, size: SZ_Q }),
        new TextRun({ text: q.text, font: FONT, size: SZ_Q }),
      ],
    })
  );

  if (q.illustration) {
    children.push(
      new Paragraph({
        spacing: { after: 40 },
        children: [
          new TextRun({
            text: `Figura / referencia: ${q.illustration}`,
            italics: true,
            font: FONT,
            size: SZ_SMALL,
            color: '444444',
          }),
        ],
      })
    );
  }

  if (q.type === 'multiple_choice' && q.options?.length) {
    for (let i = 0; i < q.options.length; i++) {
      const letter = String.fromCharCode(65 + i);
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: noBorder,
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 260, type: WidthType.DXA },
                  margins: { top: 20, bottom: 20, left: 20, right: 40 },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: '\u25cb ',
                          font: FONT,
                          size: SZ_SMALL,
                        }),
                      ],
                    }),
                  ],
                }),
                new TableCell({
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.JUSTIFIED,
                      spacing: { line: 260 },
                      children: [
                        new TextRun({ text: `${letter}.`, bold: true, font: FONT, size: SZ_SMALL }),
                        new TextRun({ text: ` ${q.options[i]}`, font: FONT, size: SZ_SMALL }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          ],
        })
      );
    }
  } else {
    for (let l = 0; l < 4; l++) {
      children.push(
        new Paragraph({
          spacing: { after: 60 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: '333333' },
          },
          children: [new TextRun({ text: '\u00A0', font: FONT, size: SZ_BODY })],
        })
      );
    }
  }
}

/**
 * Genera un .docx alineado con la hoja de impresión (cartas, hasta 10 preguntas por hoja,
 * banner, nombre/grupo/fecha, opciones con círculo, pie).
 */
export async function downloadExamWord(
  exam: ExamWithQuestions,
  filenameBase: string,
  baseUrl: string
): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  let bannerBuf: ArrayBuffer | null = null;
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/print-header-banner.png`;
    const res = await fetch(url);
    if (res.ok) bannerBuf = await res.arrayBuffer();
  } catch {
    bannerBuf = null;
  }

  try {
    const docx = await import('docx');
    const {
      Document,
      Packer,
      Paragraph,
      TextRun,
      Table,
      TableRow,
      TableCell,
      WidthType,
      PageBreak,
      AlignmentType,
      BorderStyle,
      ImageRun,
      convertInchesToTwip,
    } = docx;

    const mm = (n: number) => convertInchesToTwip(n / 25.4);
    const pageTwip = convertInchesToTwip(8.5);
    const marginSide = mm(8);
    const innerTwip = pageTwip - 2 * marginSide;
    const ratioSum = 2.35 + 0.55 + 1.1;
    const metaW1 = Math.round(innerTwip * (2.35 / ratioSum));
    const metaW2 = Math.round(innerTwip * (0.55 / ratioSum));
    const metaW3 = innerTwip - metaW1 - metaW2;

    const noBorder = {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    } as const;

    const chunks = chunkQuestions(exam.questions, 10);
    const children: FileChild[] = [];

    const metaLabelCell = (label: string) =>
      new TableCell({
        children: [
          new Paragraph({
            children: [new TextRun({ text: label, bold: true, font: FONT, size: SZ_SMALL })],
          }),
          new Paragraph({
            spacing: { after: 40 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
            },
            children: [new TextRun({ text: '\u00A0', font: FONT, size: SZ_BODY })],
          }),
        ],
      });

    for (let pageIdx = 0; pageIdx < chunks.length; pageIdx++) {
      if (pageIdx > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }

      const chunkQs = chunks[pageIdx];
      const startIdx = pageIdx * 10;
      const rangeStart = startIdx + 1;
      const rangeEnd = startIdx + chunkQs.length;

      if (bannerBuf) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
            children: [
              new ImageRun({
                type: 'png',
                data: bannerBuf,
                transformation: { width: 650, height: 70 },
              }),
            ],
          })
        );
      }

      children.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { after: 40 },
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
          },
          children: [
            new TextRun({
              text: exam.title,
              bold: true,
              font: FONT,
              size: SZ_TITLE,
            }),
          ],
        })
      );

      if (pageIdx > 0) {
        children.push(
          new Paragraph({
            alignment: AlignmentType.RIGHT,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: `Preguntas ${rangeStart} a ${rangeEnd}`,
                bold: true,
                font: FONT,
                size: SZ_RANGE,
                color: '333333',
              }),
            ],
          })
        );
      }

      if (pageIdx === 0) {
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: [metaW1, metaW2, metaW3],
            borders: noBorder,
            rows: [
              new TableRow({
                children: [
                  metaLabelCell('Nombre del alumno'),
                  metaLabelCell('Grupo'),
                  metaLabelCell('Fecha'),
                ],
              }),
            ],
          })
        );
      }

      for (let i = 0; i < chunkQs.length; i++) {
        addQuestionContent(docx, children, chunkQs[i], startIdx + i);
      }

      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 40 },
          border: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' },
          },
          children: [
            new TextRun({
              text: `Hoja para el estudiante · Hoja ${pageIdx + 1} de ${chunks.length}`,
              font: FONT,
              size: SZ_FOOTER,
              color: '666666',
            }),
          ],
        })
      );
    }

    const doc = new Document({
      sections: [
        {
          properties: {
            page: {
              size: {
                width: convertInchesToTwip(8.5),
                height: convertInchesToTwip(11),
              },
              margin: {
                top: mm(5.5),
                bottom: mm(5.5),
                left: mm(8),
                right: mm(8),
              },
            },
          },
          children,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const safeName =
      filenameBase.replace(/[^\w\s-áéíóúñÁÉÍÓÚÑ]/gi, '').slice(0, 80) || 'examen';
    const a = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    a.href = objectUrl;
    a.download = `${safeName}.docx`;
    a.click();
    URL.revokeObjectURL(objectUrl);
    return true;
  } catch {
    return false;
  }
}
