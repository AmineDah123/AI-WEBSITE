import os
import requests

from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.tools import tool

from langgraph.prebuilt import create_react_agent

from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

BASE_URL = "http://localhost:3000"

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-flash",
    google_api_key=os.getenv("GEMINIAI_API_KEY")  
)

@tool
def list_products():
    """
        List all current products from the agency's catalog
    """
    
    try:
        response = requests.get(
            f"{BASE_URL}/products"
        )

        response.raise_for_status()

        return response.json()

    except requests.RequestException as e:
        return {
            "success": False,
            "error": str(e)
        } 

@tool
def add_product(name: str, price: float, stock: int):
    """
        Add a new product to the agency's catalog
    """
    try: 
        response = requests.post(
            f"{BASE_URL}/products",
            json={
                "name": name,
                "price": price,
                "stock": stock
            }
        )

        response.raise_for_status()

        return response.json()
    except requests.RequestException as e:
        return {
            "success": False,
            "error": str(e)
        } 

@tool
def update_product(name: str, price: float, id: int):
    """
        Update a product to the agency's catalog
    """

    try:
        response = requests.put(
            f"{BASE_URL}/products/{id}",
            json={
                "name": name,
                "price": price
            }
        )

        response.raise_for_status()

        return response.json()
    except requests.RequestException as e:
        return {
            "success": False,
            "error": str(e)
        }

@tool
def remove_product(id: int):
    """
        Remove a product from the agency's catalog
    """
    try:
        response = requests.delete(
            f"{BASE_URL}/products/{id}",
        )

        response.raise_for_status()

        return response.json()
    except requests.RequestException as e:
        return {
            "success": False,
            "error": str(e)
        } 

tools = [
    list_products,
    add_product,
    update_product,
    remove_product,
]

agent = create_react_agent(
    model=llm,
    tools=tools,
    prompt="""
        You are the AI assistant for XYZ Agency.

        You may only answer questions related to the agency's business.

        If the user asks to:
        - create a product → use add_product
        - update a product → use update_product
        - delete a product → use remove_product
        - list products → use list_products

        Never claim an operation succeeded unless the tool reports success.

        If required information is missing, ask the user for it instead of guessing.
    """
)


class ChatRequest(BaseModel):
    message: str


@app.post('/chat')
async def chat(req: ChatRequest):
    result = agent.invoke(
        {
            "messages": [
                {
                    "role": "user",
                    "content": req.message
                }
            ]
        }
    )

    return {
        "reply": result["messages"][-1].content
    }