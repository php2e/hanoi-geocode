from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = Field(
        "postgresql://hanoi:hanoi@localhost:5432/hanoi_geocode",
        alias="DATABASE_URL",
    )
    cors_origins: str = Field("http://localhost:5173,http://localhost:3000", alias="CORS_ORIGINS")
    boundary_geojson_path: str = Field("../data/hanoi_bound_2026.geojson", alias="BOUNDARY_GEOJSON_PATH")
    wards_geojson_path: str = Field("../data/hanoi_wards_2026.geojson", alias="WARDS_GEOJSON_PATH")


@lru_cache
def get_settings() -> Settings:
    return Settings()
