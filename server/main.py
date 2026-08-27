import json
import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from groq import Groq


load_dotenv()


app = FastAPI()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


API_KEY = os.getenv("GROQ_API_KEY")

if not API_KEY:
    raise RuntimeError(
        "GROQ_API_KEY is not set"
    )


client = Groq(api_key=API_KEY)


@app.get("/")
async def root():
    return {
        "message": "API is running"
    }


# ============================================================
# TEXT QUESTIONS
# ============================================================

async def solve_text_batch(
    questions: list[dict[str, Any]],
) -> list[dict[str, Any]]:

    questions_json = json.dumps(
        questions,
        ensure_ascii=False,
        indent=2,
    )

    prompt = f"""
Solve the following questions.

Return ONLY JSON in this format:

{{
    "answers": [
        {{
            "questionIndex": 0,
            "answer": ["correct answer"]
        }}
    ]
}}

Important:
- questionIndex must be an integer.
- Use the exact questionIndex provided in the input.
- Return exactly one answer for every question.
- The "answer" field MUST always be an array of strings.
- For questions with multiple correct answers, include each answer as a separate item in the array.
- For questions with one correct answer, return an array containing one item.
- Copy multiple-choice and checkbox options exactly from the provided options.
- Do not return markdown.
- Do not wrap the JSON in ```.

Questions:

{questions_json}
"""

    print(
        "[Server] Sending text batch:"
    )

    print(
        [q["index"] for q in questions]
    )

    chat_completion = client.chat.completions.create(
        model="qwen/qwen3.8-27b",

        messages=[
            {
                "role": "user",
                "content": prompt,
            }
        ],

        response_format={
            "type": "json_object"
        },

        max_completion_tokens=2048,
    )

    raw_answer = (
        chat_completion
        .choices[0]
        .message
        .content
    )

    print(
        "[Server] RAW TEXT RESPONSE:"
    )

    print(raw_answer)

    result = json.loads(raw_answer)

    answers = result.get(
        "answers",
        []
    )

    return answers


# ============================================================
# IMAGE QUESTIONS
# ============================================================

def build_image_content(
    question: dict[str, Any],
) -> list[dict[str, Any]]:

    content: list[dict[str, Any]] = []

    text = f"""
Solve this question.

Question Index:
{question["index"]}

Question:
{question["question"]}

Type:
{question["type"]}

Options:
{json.dumps(
    question["options"],
    ensure_ascii=False
)}

The question may contain one or more images.
Use the image(s) together with the question and options.

Return the correct answer.
"""

    content.append({
        "type": "text",
        "text": text,
    })

    for image in question.get(
        "images",
        [],
    ):

        image_src = image.get("src")

        if not image_src:
            continue

        content.append({
            "type": "image_url",
            "image_url": {
                "url": image_src,
            },
        })

    # IMPORTANT:
    # This is NOT an f-string, so normal {} are correct.
    content.append({
        "type": "text",
        "text": """
Return ONLY JSON:

{
    "questionIndex": 0,
    "answer": ["correct answer"]
}

Rules:
- questionIndex must exactly match the question index provided.
- answer MUST always be an array of strings.
- For multiple correct answers, include each answer as a separate item.
- For one correct answer, return an array containing one item.
- Copy the option text exactly.
- Do not return markdown.
- Do not wrap the JSON in ```.
""",
    })

    return content


def solve_image_question(
    question: dict[str, Any],
) -> dict[str, Any]:

    content = build_image_content(
        question
    )

    print(
        "[Server] Sending image question:",
        question["index"],
    )

    chat_completion = client.chat.completions.create(
        model="qwen/qwen3.8-27b",

        messages=[
            {
                "role": "user",
                "content": content,
            }
        ],

        response_format={
            "type": "json_object"
        },

        max_completion_tokens=512,
    )

    raw_answer = (
        chat_completion
        .choices[0]
        .message
        .content
    )

    print(
        "[Server] RAW IMAGE RESPONSE:"
    )

    print(raw_answer)

    result = json.loads(raw_answer)

    return result


# ============================================================
# VALIDATION
# ============================================================

def validate_answers(
    questions: list[dict[str, Any]],
    answers: list[dict[str, Any]],
) -> None:

    expected_indices = {
        question["index"]
        for question in questions
    }

    received_indices = [
        answer.get("questionIndex")
        for answer in answers
    ]

    received_set = set(
        received_indices
    )

    # Check for missing questions
    missing = (
        expected_indices -
        received_set
    )

    if missing:
        raise ValueError(
            f"Missing answers for question indexes: "
            f"{sorted(missing)}"
        )

    # Check for unexpected indexes
    extra = (
        received_set -
        expected_indices
    )

    if extra:
        raise ValueError(
            f"Unexpected question indexes: "
            f"{sorted(extra)}"
        )

    # Check duplicates
    if len(received_indices) != len(
        received_set
    ):
        duplicates = [
            index
            for index in received_indices
            if received_indices.count(index) > 1
        ]

        raise ValueError(
            f"Duplicate question indexes: "
            f"{sorted(set(duplicates))}"
        )

    # Check answer format
    for answer in answers:

        question_index = answer.get(
            "questionIndex"
        )

        value = answer.get(
            "answer"
        )

        if not isinstance(
            question_index,
            int,
        ):
            raise ValueError(
                f"questionIndex must be an integer: "
                f"{question_index}"
            )

        if not isinstance(
            value,
            list,
        ):
            raise ValueError(
                f"Answer for question "
                f"{question_index} must be an array"
            )

        if not all(
            isinstance(item, str)
            for item in value
        ):
            raise ValueError(
                f"All answers for question "
                f"{question_index} must be strings"
            )


# ============================================================
# SOLVE ENDPOINT
# ============================================================

@app.post("/solve")
async def solve(
    form: dict[str, Any]
):

    questions = form.get(
        "questions",
        []
    )

    print(
        "[Server] Total questions:",
        len(questions),
    )

    # --------------------------------------------------------
    # Separate text and image questions
    # --------------------------------------------------------

    text_questions: list[
        dict[str, Any]
    ] = []

    image_questions: list[
        dict[str, Any]
    ] = []

    for question in questions:

        images = question.get(
            "images",
            []
        )

        if images:
            image_questions.append(
                question
            )
        else:
            text_questions.append(
                question
            )

    print(
        "[Server] Text questions:",
        len(text_questions),
    )

    print(
        "[Server] Image questions:",
        len(image_questions),
    )

    # --------------------------------------------------------
    # Solve text questions in batches
    # --------------------------------------------------------

    BATCH_SIZE = 7

    text_answers: list[
        dict[str, Any]
    ] = []

    for i in range(
        0,
        len(text_questions),
        BATCH_SIZE,
    ):

        batch = text_questions[
            i:i + BATCH_SIZE
        ]

        batch_number = (
            i // BATCH_SIZE
        ) + 1

        print(
            f"[Server] Solving text batch "
            f"{batch_number}:",
            [
                q["index"]
                for q in batch
            ],
        )

        answers = await solve_text_batch(
            batch
        )

        text_answers.extend(
            answers
        )

    # --------------------------------------------------------
    # Solve image questions individually
    # --------------------------------------------------------

    image_answers: list[
        dict[str, Any]
    ] = []

    for question in image_questions:

        print(
            "[Server] Solving image question:",
            question["index"],
        )

        answer = solve_image_question(
            question
        )

        image_answers.append(
            answer
        )

    # --------------------------------------------------------
    # Combine
    # --------------------------------------------------------

    answers = (
        text_answers +
        image_answers
    )

    # --------------------------------------------------------
    # Validate BEFORE filling
    # --------------------------------------------------------

    try:

        validate_answers(
            questions,
            answers,
        )

    except ValueError as e:

        print(
            "[Server] ❌ Answer validation failed:"
        )

        print(e)

        return {
            "message": "ERROR",
            "error": str(e),
        }

    # --------------------------------------------------------
    # Sort
    # --------------------------------------------------------

    answers.sort(
        key=lambda x: x["questionIndex"]
    )

    print(
        "[Server] FINAL ANSWERS:"
    )

    print(
        json.dumps(
            answers,
            indent=2,
            ensure_ascii=False,
        )
    )

    return {
        "message": "FILL_FORM",
        "answers": answers,
    }