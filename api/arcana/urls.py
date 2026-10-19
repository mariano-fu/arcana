from django.contrib import admin
from django.urls import path

from core.auth import LoginView, RefreshView
from core.views import health
from sync.views import sync

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health, name="health"),
    path("api/auth/token/", LoginView.as_view(), name="auth-token"),
    path("api/auth/token/refresh/", RefreshView.as_view(), name="auth-token-refresh"),
    path("api/sync/", sync, name="sync"),
]
