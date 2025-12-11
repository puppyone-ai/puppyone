import supabase
import os

from dotenv import load_dotenv
load_dotenv()

supabase = supabase.create_client(
    supabase_url=os.getenv("SUPABASE_URL"),
    supabase_key=os.getenv("SUPABASE_KEY"),
)

user = supabase.auth.sign_in_with_password(
    {
        "email": "1655929802@qq.com",
        "password": "123456",
    }
)

print(user)