from django import forms

from .models import User


class InviteUserCreationForm(forms.ModelForm):
    class Meta:
        model = User
        fields = ("username", "email", "first_name", "last_name", "role", "preferred_language")

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["email"].required = True
        self.fields["username"].help_text = "Συνιστάται χρήση του email ως όνομα χρήστη."
        self.fields["email"].help_text = "Ο προσωρινός κωδικός θα αποσταλεί σε αυτή τη διεύθυνση."

    def save(self, commit=True):
        user = super().save(commit=False)
        user.set_unusable_password()
        if commit:
            user.save()
        return user
