import os
from dotenv import load_dotenv
from typing import Dict, Any

from supabase import create_client, Client
from supabase.client import ClientOptions

load_dotenv()

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(
    url,
    key,
    options=ClientOptions(
        postgrest_client_timeout=10,
        storage_client_timeout=30,
        schema="public",
    )
)

def insert_data_example():
    # Create a record
    response = (
        supabase.table("planets")
        .insert({"id": 1, "name": "Pluto"})
        .execute()
    )

    # Bulk create
    try:
        response = (
            supabase.table("characters")
            .insert([
                {"id": 1, "name": "Frodo"},
                {"id": 2, "name": "Sam"},
            ])
            .execute()
        )
        return response
    except Exception as exception:
        return exception

def fetch_data_example():
    # Get data
    response = (
        supabase.table("planets")
        .select("*")
        .execute()
    )

    response = (
        supabase.table("planets")
        .select("name")
        .execute()
    )

    # query reference table
    response = (
        supabase.table("orchestral_sections")
        .select("name, instruments(name)")
        .execute()
    )

    # Query referenced tables through a join table
    response = (
        supabase.table("users")
        .select("name, teams(name)")
        .execute()
    )

    # Filtering through referenced tables
    response = (
        supabase.table("orchestral_sections")
        .select("name, instruments(*)")
        .eq("instruments.name", "guqin")
        .execute()
    )

    # Querying referenced table with count
    response = (
        supabase.table("orchestral_sections")
        .select("*, instruments(count)")
        .execute()
    )

    # Querying with count option
    response = (
        supabase.table("planets")
        .select("*", count="exact")
        .execute()
    )

    # Querying JSON data
    response = (
        supabase.table("users")
        .select("id, name, address->city")
        .execute()
    )

    # Querying referenced table with inner join
    response = (
        supabase.table("instruments")
        .select("name, orchestral_sections!inner(name)")
        .eq("orchestral_sections.name", "woodwinds")
        .execute()
    )

    # Switching schemas per query
    response = (
        supabase.schema("myschema")
        .table("mytable")
        .select("*")
        .execute()
    )


def update_data_example():
    # Updating your data
    response = (
        supabase.table("instruments")
        .update({"name": "piano"})
        .eq("id", 1)
        .execute()
    )

    # update json data
    response = (
        supabase.table("users")
        .update({"address": {"street": "Melrose Place", "postcode": 90210}})
        .eq("address->postcode", 90210)
        .execute()
    )

def upsert_data_example():
    # upsert data
    response = (
        supabase.table("instruments")
        .upsert({"id": 1, "name": "piano"})
        .execute()
    )

    # Bulk Upsert your data
    response = (
        supabase.table("instruments")
        .upsert([{"id": 1, "name": "piano"}, {"id": 2, "name": "guitar"}])
        .execute()
    )

    # Upserting into tables with constraints
    response = (
        supabase.table("users")
        .upsert(
            {"id": 42, "handle": "saoirse", "display_name": "Saoirse"},
            on_conflict="handle",
        )
        .execute()
    )

def delete_data_example():
    # Deleting your data
    response = (
        supabase.table("instruments")
        .delete()
        .eq("id", 1)
        .execute()
    )
    
    # delete multiple records
    response = (
        supabase.table("countries")
        .delete()
        .in_("id", [1, 2, 3])
        .execute()
    )

def using_filtering():
    # Correct
    response = (
        supabase.table("instruments")
        .select("name, section_id")
        .eq("name", "flute")
        .execute()
    )

    # Incorrect
    response = (
        supabase.table("instruments")
        .eq("name", "flute")
        .select("name, section_id")
        .execute()
    )

    # chain
    response = (
        supabase.table("instruments")
        .select("name, section_id")
        .gte("octave_range", 3)
        .lt("octave_range", 7)
        .execute()
    )

    # Conditional chaining
    filterByName = None
    filterOctaveLow = 3
    filterOctaveHigh = 7

    query = supabase.table("instruments").select("name, section_id")

    if filterByName:
        query = query.eq("name", filterByName)

    if filterAgeLow:
        query = query.gte("octave_range", filterOctaveLow)

    if filterAgeHigh:
        query = query.lt("octave_range", filterOctaveHigh)

    response = query.execute()

    # Filter by values within JSON column
    response = (
        supabase.table("users")
        .select("*")
        .eq("address->postcode", 90210)
        .execute()
    )

    # Filter Foreign Tables
    response = (
        supabase.table("orchestral_sections")
        .select("name, instruments!inner(name)")
        .eq("instruments.name", "flute")
        .execute()
    )


if __name__ == "__main__":
    """
    Your test here.
    Available database table: project表
    """
        