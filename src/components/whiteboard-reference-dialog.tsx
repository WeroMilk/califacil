'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ExamWhiteboard } from '@/components/exam-whiteboard';
import {
  decodeWhiteboardReference,
  encodeWhiteboardCorrectAnswer,
} from '@/lib/whiteboardAnswer';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialReference?: string | null;
  onSave: (encodedReference: string) => void;
};

export function WhiteboardReferenceDialog({
  open,
  onOpenChange,
  initialReference,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(decodeWhiteboardReference(initialReference ?? null) ?? null);
    }
  }, [open, initialReference]);

  const handleSave = () => {
    if (!draft || !draft.startsWith('data:image/')) return;
    onSave(encodeWhiteboardCorrectAnswer(draft));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Respuesta de referencia en pizarrón</DialogTitle>
          <DialogDescription>
            Dibuja la solución esperada. Los alumnos responderán en un pizarrón similar y el maestro
            podrá comparar visualmente al calificar.
          </DialogDescription>
        </DialogHeader>
        <ExamWhiteboard value={draft} onChange={setDraft} minHeight={300} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            className="bg-orange-600 hover:bg-orange-700"
            disabled={!draft?.startsWith('data:image/')}
            onClick={handleSave}
          >
            Guardar referencia
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
