import os
import requests

from dotenv import load_dotenv

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain.tools import tool

from langgraph.prebuilt import create_react_agent

import fastapi from FastAPI
import pydantic from BaseModel

BASE_URL = "http://localhost:3000/api"

load_dotenv()

app = FastAPI()

llm = ChatGoogleGenerativeAI(
    model="gemini-2.5-pro",
    google_api_key=os.getenv("GEMINIAI_API_KEY")  
)


@tool
def add_product(name: str, price: float, stock: int):
    """
        Add a new product to the agency's catalog
    """

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


@tool
def update_product(name: str, price: float, id: int):
    """
        Update a product to the agency's catalog
    """

    response = requests.put(
        f"{BASE_URL}/products/{id}",
        json={
            "name": name,
            "price": price
        }
    )

    response.raise_for_status()

    return response.json()


@tool
def remove_product(id: int):
    """
        Remove a product from the agency's catalog
    """

    response = requests.delete(
        f"{BASE_URL}/products/{id}",
    )

    response.raise_for_status()

    return response.json()


tools = [
    add_products,
    update_products,
    remove_products,
]

agent = create_react_agent(
    model=llm,
    tools=tools,
    prompt="""
        You are an AI assistant for XYZ Agency.

        Your responsibilities are:
        - Help customers.
        - Manage products.
        - Manage reservations.
        - Use the provided tools whenever an action needs to be performed.
        - Never pretend an action succeeded.
        - Wait for the tool result before answering.
        - If information is missing, ask the user.
    """
)