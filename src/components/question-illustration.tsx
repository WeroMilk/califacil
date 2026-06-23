import { isQuestionIllustrationImage } from '@/lib/utils';

type Props = {
  illustration: string | null | undefined;
  className?: string;
};

export function QuestionIllustration({ illustration, className = '' }: Props) {
  if (!illustration?.trim()) return null;
  const value = illustration.trim();

  if (isQuestionIllustrationImage(value)) {
    return (
      <div className={`rounded-lg border border-gray-200 bg-white p-3 ${className}`.trim()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={value}
          alt="Ilustración de apoyo"
          className="mx-auto max-h-72 max-w-full rounded object-contain"
        />
      </div>
    );
  }

  return (
    <div className={`rounded-lg bg-white/35 p-4 backdrop-blur-[2px] ${className}`.trim()}>
      <p className="text-sm italic text-gray-500">
        <span className="font-medium not-italic text-gray-600">Ilustración:</span> {value}
      </p>
    </div>
  );
}
