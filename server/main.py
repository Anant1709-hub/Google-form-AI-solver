import json

from fastapi import FastAPI
from dotenv import load_dotenv
import os
from fastapi.middleware.cors import CORSMiddleware
from typing import Any
from groq import Groq
from google import genai
from rate_limiter import (wait_for_gemini_rate_limit,wait_for_image_rate_limit)

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.getenv("GROQ_API_KEY")
gemini_api_key = os.getenv("GEMINI_API_KEY")

pdf_url=""
with open("pdf_uri.txt", "r") as f:
    PDF_URI = f.read().strip()
    pdf_url = PDF_URI


client1 = Groq(api_key=API_KEY)
client2 = genai.Client(api_key=gemini_api_key)

@app.get("/")
async def root():
    return {"message": "API is running"}

async def make_gemini_request(question: str):
    chat_completion = client2.interactions.create(
        model="gemini-3.5-flash-lite",

        input=f"""
You are solving an expert-level multiple-choice exam.

For each question, independently determine the correct answer.

IMPORTANT:
- Do not select an option merely because it is related to the topic.
- Evaluate every option against the exact wording of the question.
- Prefer the option that is specifically and directly correct.
- Reject options that are only partially correct, overly broad, or describe
  a related concept rather than what the question asks.
- "All of the above" is correct ONLY if every individual option is correct.
- For True/False questions, determine the truth of the exact statement.
- Do not assume a statement is true merely because it sounds scientifically plausible.
- For scientific questions, use your underlying domain knowledge and
  distinguish established mechanisms from associations.
- Before giving the final answer, independently verify your selected option.

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
- For questions with multiple correct answers, include each answer as a separate item.
- For questions with one correct answer, return an array containing one item.
- Copy multiple-choice and checkbox options exactly from the provided options.
- Do not return markdown.
- Do not wrap the JSON in ```.

Questions:

{question}
""",

        response_format={
            "type": "text",
            "mime_type": "application/json",
            "schema": {
                "type": "object",
                "properties": {
                    "answers": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "questionIndex": {
                                    "type": "integer"
                                },
                                "answer": {
                                    "type": "array",
                                    "items": {
                                        "type": "string"
                                    }
                                }
                            },
                            "required": [
                                "questionIndex",
                                "answer"
                            ]
                        }
                    }
                },
                "required": [
                    "answers"
                ]
            }
        },

        generation_config={
            "thinking_level": "medium",
            "max_output_tokens": 4096,
        }
    )

    return chat_completion


async def solve_text_batch_gemini(
    questions: list[dict[str, Any]]
) -> list[dict[str, Any]]:

    questions_json = json.dumps(
        questions,
        ensure_ascii=False,
        indent=2,
    )

    print("\n========== GEMINI BATCH ==========")
    print(questions_json)
    print("==================================\n")

    await wait_for_gemini_rate_limit()

    response = await make_gemini_request(
        question=questions_json
    )

    raw_answer = response.output_text

    print("\n========== GEMINI RESPONSE ==========")
    print(repr(raw_answer))
    print("======================================\n")

    try:
        result = json.loads(raw_answer)

    except json.JSONDecodeError as e:

        print("[Gemini] JSON parsing failed!")
        print("[Gemini] Error:", e)
        print("[Gemini] Retrying...")

        await wait_for_gemini_rate_limit()

        response = await make_gemini_request(
            question=questions_json
        )

        raw_answer = response.output_text

        print("\n========== GEMINI RETRY ==========")
        print(repr(raw_answer))
        print("==================================\n")

        try:
            result = json.loads(raw_answer)

        except json.JSONDecodeError:
            print("[Gemini] Retry also failed.")
            raise

    return result["answers"]

async def solve_text_batch(
    questions: list[dict[str, Any]],
) -> list[dict[str, Any]]:

    questions_json = json.dumps(
        questions,
        ensure_ascii=False,
        indent=2,
    )

    chat_completion = client1.chat.completions.create(
        # model="openai/gpt-oss-120b",
        model="qwen/qwen3.8-27b",

        messages=[
            {
                "role": "user",
                "content": f"""
                        Solve the following questions.

                        Return ONLY JSON in this format:

                        {{"answers": [
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
                        """,
            }
        ],

        response_format={
            "type": "json_object"
        },

        max_completion_tokens=2048,
        temperature=0
    )

    raw_answer = (
        chat_completion
        .choices[0]
        .message
        .content
    )

    result = json.loads(raw_answer)

    # print("[Server] Text batch result:", result)

    return result["answers"]

def build_image_content(
    question: dict[str, Any],
) -> list[dict[str, Any]]:

    content = []

    text = f"""
        Solve this question.
        Question Index: {question["index"]}
        Question: {question["question"]}
        Type: {question["type"]}
        Options:
        {json.dumps(
            question["options"],
            ensure_ascii=False
        )}
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
        content.append({
            "type": "image_url",
            "image_url": {
                "url": image["src"],
            },
        })

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
        - Copy the option text exactly.
        Do not return markdown.
        """,
    })

    return content

def solve_image_question(
    question: dict[str, Any],
):
    wait_for_image_rate_limit()

    content = build_image_content(question)

    chat_completion = client1.chat.completions.create(
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
        temperature=0,
    )

    raw_answer = (
        chat_completion
        .choices[0]
        .message
        .content
    )

    return json.loads(raw_answer)



@app.post("/solve")
async def solve(form: dict[str, Any]):

    questions = form["questions"]

    BATCH_SIZE = 5

    answers = []

    for i in range(0, len(questions), BATCH_SIZE):

        batch = questions[i:i + BATCH_SIZE]

        print(
            f"[Server] Solving batch "
            f"{i // BATCH_SIZE + 1}"
        )

        batch_answers = await solve_text_batch_gemini(
            questions=batch
        )

        answers.extend(batch_answers)

    answers.sort(
        key=lambda x: x["questionIndex"]
    )

    print("[Server] FINAL ANSWERS:")
    print(answers)

    return {
        "message": "FILL_FORM",
        "answers": answers,
    }