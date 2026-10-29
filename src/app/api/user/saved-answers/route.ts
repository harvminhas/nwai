import { NextRequest } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

interface SavedAnswer {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

/**
 * GET /api/user/saved-answers
 * Returns all saved answers for the user
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const savedAnswersSnap = await db
      .collection("users")
      .doc(decoded.uid)
      .collection("savedAnswers")
      .orderBy("createdAt", "desc")
      .limit(100)
      .get();

    const savedAnswers: SavedAnswer[] = savedAnswersSnap.docs.map(doc => ({
      id: doc.id,
      ...(doc.data() as Omit<SavedAnswer, "id">),
    }));

    return Response.json({ savedAnswers });
  } catch (error) {
    console.error("Get saved answers error:", error);
    return Response.json(
      { error: "Failed to get saved answers" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/user/saved-answers
 * Saves a new answer
 * Body: { question: string, answer: string }
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const body = await req.json();
    const { question, answer } = body;

    if (!question || !answer) {
      return Response.json(
        { error: "Question and answer are required" },
        { status: 400 }
      );
    }

    const savedAnswerRef = await db
      .collection("users")
      .doc(decoded.uid)
      .collection("savedAnswers")
      .add({
        question: question.trim(),
        answer: answer.trim(),
        createdAt: new Date().toISOString(),
      });

    return Response.json({
      id: savedAnswerRef.id,
      message: "Answer saved successfully",
    });
  } catch (error) {
    console.error("Save answer error:", error);
    return Response.json(
      { error: "Failed to save answer" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/user/saved-answers
 * Deletes a saved answer
 * Body: { id: string }
 */
export async function DELETE(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const body = await req.json();
    const { id } = body;

    if (!id) {
      return Response.json({ error: "ID is required" }, { status: 400 });
    }

    await db
      .collection("users")
      .doc(decoded.uid)
      .collection("savedAnswers")
      .doc(id)
      .delete();

    return Response.json({ message: "Answer deleted successfully" });
  } catch (error) {
    console.error("Delete saved answer error:", error);
    return Response.json(
      { error: "Failed to delete answer" },
      { status: 500 }
    );
  }
}
