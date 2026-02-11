# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytz
import requests
from langdetect import detect
from datetime import datetime, timedelta


class CodeSnippets:
    def __init__(
        self
    ):
        self.func_dict = {
            "get_current_time": self._get_current_time,
            "get_current_date": self._get_current_date,
            "get_current_timestamp": self._get_current_timestamp,
            "get_current_timezone": self._get_current_timezone,
            "get_current_week_day": self._get_current_week_day,
            "get_current_month": self._get_current_month,
            "get_current_year": self._get_current_year,
            "timestamp_to_human_readable": self._timestamp_to_human_readable,
            "modify_date_by_days": self._modify_date_by_days,
            "get_current_country": self._get_current_country,
            "get_current_continent": self._get_current_continent,
            "get_current_language": self._get_current_language,
            "detect_language_from_text": self._detect_language_from_text,
            "convert_timezone": self._convert_timezone
        }
    
    def execute(
        self,
        func_name: str,
        *args
    ) -> str:
        func = self.func_dict.get(func_name)
        if not func:
            return f"Unsupported Function: {func_name}"
        return func(*args)
    
    def _get_current_time(
        self
    ) -> str:
        return datetime.now().strftime("%H:%M:%S")

    def _get_current_date(
        self
    ) -> str:
        return datetime.now().strftime("%Y-%m-%d")

    def _get_current_timestamp(
        self
    ) -> str:
        return str(int(datetime.now().timestamp()))

    def _get_current_timezone(
        self
    ) -> str:
        return datetime.now().astimezone().tzinfo

    def _get_current_week_day(
        self
    ) -> str:
        return datetime.now().strftime("%A")

    def _get_current_month(
        self
    ) -> str:
        return datetime.now().strftime("%B")

    def _get_current_year(
        self
    ) -> str:
        return datetime.now().year

    def _timestamp_to_human_readable(
        self,
        timestamp: int
    ) -> str:
        return datetime.fromtimestamp(timestamp).strftime("%Y-%m-%d %H:%M:%S")

    def _modify_date_by_days(
        self,
        date: str,
        days: int
    ) -> str:
        date_obj = datetime.strptime(date, "%Y-%m-%d")
        modified_date = date_obj + timedelta(days=days)
        return modified_date.strftime("%Y-%m-%d")

    def _get_current_country(
        self
    ) -> str:
        try:
            response = requests.get("https://ipapi.co/country/")
            return response.text if response.status_code == 200 else "Unknown"
        except Exception as e:
            return f"Error: {e}"

    def _get_current_continent(
        self
    ) -> str:
        try:
            response = requests.get("https://ipapi.co/continent_code/")
            return response.text if response.status_code == 200 else "Unknown"
        except Exception as e:
            return f"Error: {e}"

    def _get_current_language(
        self
    ) -> str:
        try:
            response = requests.get("https://ipapi.co/languages/")
            if response.status_code == 200:
                languages = response.text.split(",")[0]
                return languages if languages else "Unknown"
            else:
                return "Unknown"
        except Exception as e:
            return f"Error: {e}"

    def _detect_language_from_text(
        self,
        text: str
    ) -> str:
        try:
            return detect(text)
        except Exception as e:
            return f"Error: {e}"

    def _convert_timezone(
        self,
        timestamp: int,
        from_tz: str,
        to_tz: str
    ) -> str:
        try:
            from_zone = pytz.timezone(from_tz)
            to_zone = pytz.timezone(to_tz)
            utc_time = datetime.fromtimestamp(timestamp, from_zone)
            converted_time = utc_time.astimezone(to_zone)
            return converted_time.strftime("%Y-%m-%d %H:%M:%S")
        except Exception as e:
            return f"Error: {e}"


if __name__ == "__main__":
    snippets = CodeSnippets()
    print("Current Time:", snippets.execute("get_current_time"))
    print("Current Date:", snippets.execute("get_current_date"))
    print("Current Timestamp:", snippets.execute("get_current_timestamp"))
    print("Current Timezone:", snippets.execute("get_current_timezone"))
    print("Current Week Day:", snippets.execute("get_current_week_day"))
    print("Current Month:", snippets.execute("get_current_month"))
    print("Current Year:", snippets.execute("get_current_year"))
    print("Timestamp to Human Readable:", snippets.execute("timestamp_to_human_readable", 1630902000))
    print("Modified Date by Days:", snippets.execute("modify_date_by_days", "2022-09-06", 7))
    print("Current Country:", snippets.execute("get_current_country"))
    print("Current Continent:", snippets.execute("get_current_continent"))
    print("Current Language:", snippets.execute("get_current_language"))
    print("Detect Language from Text:", snippets.execute("detect_language_from_text", "Bonjour le monde"))
    print("Convert Timezone:", snippets.execute("convert_timezone", 1630902000, "UTC", "America/New_York"))
