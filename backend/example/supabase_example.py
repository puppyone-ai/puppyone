import os
from dotenv import load_dotenv

from supabase import create_client, Client
from supabase.client import ClientOptions

load_dotenv()

_SELECT_NAME_SECTION = "name, section_id"

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
    (
        supabase.table("planets")
        .select("*")
        .execute()
    )

    (
        supabase.table("planets")
        .select("name")
        .execute()
    )

    # query reference table
    (
        supabase.table("orchestral_sections")
        .select("name, instruments(name)")
        .execute()
    )

    # Query referenced tables through a join table
    (
        supabase.table("users")
        .select("name, teams(name)")
        .execute()
    )

    # Filtering through referenced tables
    (
        supabase.table("orchestral_sections")
        .select("name, instruments(*)")
        .eq("instruments.name", "guqin")
        .execute()
    )

    # Querying referenced table with count
    (
        supabase.table("orchestral_sections")
        .select("*, instruments(count)")
        .execute()
    )

    # Querying with count option
    (
        supabase.table("planets")
        .select("*", count="exact")
        .execute()
    )

    # Querying JSON data
    (
        supabase.table("users")
        .select("id, name, address->city")
        .execute()
    )

    # Querying referenced table with inner join
    (
        supabase.table("instruments")
        .select("name, orchestral_sections!inner(name)")
        .eq("orchestral_sections.name", "woodwinds")
        .execute()
    )

    # Switching schemas per query
    (
        supabase.schema("myschema")
        .table("mytable")
        .select("*")
        .execute()
    )


def update_data_example():
    # Updating your data
    (
        supabase.table("instruments")
        .update({"name": "piano"})
        .eq("id", 1)
        .execute()
    )

    # update json data
    (
        supabase.table("users")
        .update({"address": {"street": "Melrose Place", "postcode": 90210}})
        .eq("address->postcode", 90210)
        .execute()
    )

def upsert_data_example():
    # upsert data
    (
        supabase.table("instruments")
        .upsert({"id": 1, "name": "piano"})
        .execute()
    )

    # Bulk Upsert your data
    (
        supabase.table("instruments")
        .upsert([{"id": 1, "name": "piano"}, {"id": 2, "name": "guitar"}])
        .execute()
    )

    # Upserting into tables with constraints
    (
        supabase.table("users")
        .upsert(
            {"id": 42, "handle": "saoirse", "display_name": "Saoirse"},
            on_conflict="handle",
        )
        .execute()
    )

def delete_data_example():
    # Deleting your data
    (
        supabase.table("instruments")
        .delete()
        .eq("id", 1)
        .execute()
    )

    # delete multiple records
    (
        supabase.table("countries")
        .delete()
        .in_("id", [1, 2, 3])
        .execute()
    )

def using_filtering():
    # Correct
    (
        supabase.table("instruments")
        .select(_SELECT_NAME_SECTION)
        .eq("name", "flute")
        .execute()
    )

    # Incorrect
    (
        supabase.table("instruments")
        .eq("name", "flute")
        .select(_SELECT_NAME_SECTION)
        .execute()
    )

    # chain
    (
        supabase.table("instruments")
        .select(_SELECT_NAME_SECTION)
        .gte("octave_range", 3)
        .lt("octave_range", 7)
        .execute()
    )

    # Conditional chaining
    filter_by_name = None
    filter_octave_low = 3
    filter_octave_high = 7

    query = supabase.table("instruments").select(_SELECT_NAME_SECTION)

    if filter_by_name:
        query = query.eq("name", filter_by_name)

    if filter_octave_low:
        query = query.gte("octave_range", filter_octave_low)

    if filter_octave_high:
        query = query.lt("octave_range", filter_octave_high)

    query.execute()

    # Filter by values within JSON column
    (
        supabase.table("users")
        .select("*")
        .eq("address->postcode", 90210)
        .execute()
    )

    # Filter Foreign Tables
    (
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
