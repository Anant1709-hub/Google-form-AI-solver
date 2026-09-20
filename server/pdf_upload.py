from google import genai
import os
from dotenv import load_dotenv

load_dotenv()

gemini_api_key = os.getenv("GEMINI_API_KEY")
print("GEMINI_API_KEY:", gemini_api_key)
client2 = genai.Client(api_key=gemini_api_key)

pdf_file = client2.files.upload(
    file="C:\\google-form-solver\\documents\\Jerkovic and Cavalli 2021_Nature Mol Cell Biology Review.pdf"
)

print("PDF uploaded successfully")
print("URI:", pdf_file.uri)

with open("pdf_uri.txt", "w") as f:
    f.write(pdf_file.uri)