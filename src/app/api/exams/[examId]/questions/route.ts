import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const { examId } = params;
    const { questions } = await request.json();

    if (!Array.isArray(questions) || questions.length === 0) {
      return NextResponse.json(
        { error: 'Questions array is required' },
        { status: 400 }
      );
    }

    const questionsWithExamId = questions.map(q => ({
      ...q,
      exam_id: examId,
    }));

    const { data, error } = await supabase
      .from('questions')
      .insert(questionsWithExamId)
      .select();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to add questions', message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ questions: data });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
