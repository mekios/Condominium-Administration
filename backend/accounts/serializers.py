from rest_framework import serializers


class MeSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
    email = serializers.EmailField(allow_blank=True)
    role = serializers.CharField()
    preferred_language = serializers.CharField()
