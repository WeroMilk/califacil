'use client';

import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { QuestionIllustration } from '@/components/question-illustration';
import type { ExamCroppedImage } from '@/lib/pdfClientPreview';
import { findCroppedImageId } from '@/lib/pdfClientPreview';

type Props = {
  questionIndex: number;
  croppedImages: ExamCroppedImage[];
  illustration: string | undefined;
  onChange: (illustration: string | undefined) => void;
};

export function QuestionImagePicker({
  questionIndex,
  croppedImages,
  illustration,
  onChange,
}: Props) {
  if (croppedImages.length === 0) return null;

  const enabled = Boolean(illustration);
  const selectedId = findCroppedImageId(croppedImages, illustration) ?? croppedImages[0]?.id ?? '';
  const checkboxId = `include-image-${questionIndex}`;

  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50/80 p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={checkboxId}
          checked={enabled}
          onCheckedChange={(checked) => {
            if (checked === true) {
              const img = croppedImages.find((c) => c.id === selectedId) ?? croppedImages[0];
              onChange(img?.dataUrl);
            } else {
              onChange(undefined);
            }
          }}
        />
        <Label htmlFor={checkboxId} className="font-normal">
          Incluir imagen ilustrativa
        </Label>
      </div>

      {enabled && (
        <div className="space-y-2">
          <Label className="text-xs text-gray-600">Imagen a mostrar</Label>
          <Select
            value={selectedId}
            onValueChange={(id) => {
              const img = croppedImages.find((c) => c.id === id);
              onChange(img?.dataUrl);
            }}
          >
            <SelectTrigger className="max-w-md bg-white">
              <SelectValue placeholder="Elige una imagen" />
            </SelectTrigger>
            <SelectContent>
              {croppedImages.map((img) => (
                <SelectItem key={img.id} value={img.id}>
                  {img.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <QuestionIllustration illustration={illustration} />
        </div>
      )}
    </div>
  );
}
