import json

from fastapi import FastAPI
from dotenv import load_dotenv
import os
from fastapi.middleware.cors import CORSMiddleware
from typing import Any
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

client = Groq(api_key=API_KEY)

@app.get("/")
async def root():
    return {"message": "API is running"}

@app.post("/solve")
async def solve(form: dict[str, Any]):
    print(form)
    print(API_KEY)

    for question in form["questions"]:
        question.pop("required", None)

    print(form)

    questions = json.dumps(
        form["questions"],
        ensure_ascii=False,
        indent=2
    )

    # models = client.models.list()

    # for model in models.data:
    #     print(model.id)
    chat_completion = client.chat.completions.create(
                            messages=[
                                {
                                    "role": "user",
                                    "content": f"""
                                            Solve the following questions.
                                            Return ONLY a JSON array
                                            The format must be:
                                            [{{
                                                "questionIndex": 0,
                                                "answer": "correct answer"
                                            }}]

                                            Important:
                                            - questionIndex must be an integer.
                                            - Return one object for each question.
                                            - Do not return markdown.
                                            - Do not wrap the JSON in ```.

                                            Questions:
                                            {questions}
                                            """,
                                }
                                    ],
                            model="openai/gpt-oss-120b",
                        )

    raw_answer = chat_completion.choices[0].message.content

    print("RAW LLM RESPONSE:")
    print(raw_answer)

    try:
        answers = json.loads(raw_answer)
    except json.JSONDecodeError as e:
        print("Failed to parse LLM response:")
        print(e)

        return {
            "message": "ERROR",
            "error": "LLM returned invalid JSON",
        }

    print("PARSED ANSWERS:")
    print(answers)

    return {
        "message": "FILL_FORM",
        "answers": answers,
    }