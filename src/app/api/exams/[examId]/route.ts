import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const { examId } = params;
    const updates = await request.json();

    const { data, error } = await supabase
      .from('exams')
      .update(updates)
      .eq('id', examId)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: 'Failed to update exam', message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ exam: data });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { examId: string } }
) {
  try {
    const { examId } = params;

    const { error } = await supabase
      .from('exams')
      .delete()
      .eq('id', examId);

    if (error) {
      return NextResponse.json(
        { error: 'Failed to delete exam', message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
