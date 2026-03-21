import os
from decimal import Decimal, ROUND_HALF_UP
from datetime import date
from io import BytesIO

from django.core.mail import EmailMessage
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import (
    Apartment,
    ApartmentUser,
    ExpenseItem,
    HeatedWaterMeasurementInput,
    HeatingMeasurementInput,
    Invoice,
    InvoiceDocument,
    NotificationDispatch,
    PaymentRecord,
)
from .serializers import (
    ApartmentHeatingFactorsSerializer,
    ApartmentSerializer,
    ExpenseItemSerializer,
    HeatedWaterBulkUpsertSerializer,
    HeatingMeasurementInputSerializer,
    HeatingBulkUpsertSerializer,
    HeatedWaterMeasurementInputSerializer,
    InvoiceMarkPaidSerializer,
    InvoiceGenerateSerializer,
    InvoiceSerializer,
    PaymentRecordSerializer,
    MonthlyMeasurementUpsertSerializer,
)


def q2(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def q1(value: Decimal) -> Decimal:
    return value.quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)


def month_after(month: str) -> str:
    y, m = month.split("-")
    year = int(y)
    month_int = int(m)
    if month_int == 12:
        return f"{year + 1}-01"
    return f"{year:04d}-{month_int + 1:02d}"


def date_after(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def parse_month(value: str) -> tuple[int, int]:
    year_str, month_str = value.split("-")
    return int(year_str), int(month_str)


_PDF_FONTS_REGISTERED = False


def _register_pdf_fonts() -> tuple[str, str]:
    global _PDF_FONTS_REGISTERED
    if not _PDF_FONTS_REGISTERED:
        font_candidates = [
            (
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            ),
            (
                "/usr/share/fonts/dejavu/DejaVuSans.ttf",
                "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
            ),
        ]
        for regular_path, bold_path in font_candidates:
            if os.path.exists(regular_path) and os.path.exists(bold_path):
                pdfmetrics.registerFont(TTFont("AppSans", regular_path))
                pdfmetrics.registerFont(TTFont("AppSans-Bold", bold_path))
                _PDF_FONTS_REGISTERED = True
                return "AppSans", "AppSans-Bold"
    if "AppSans" in pdfmetrics.getRegisteredFontNames() and "AppSans-Bold" in pdfmetrics.getRegisteredFontNames():
        return "AppSans", "AppSans-Bold"
    return "Helvetica", "Helvetica-Bold"


def _format_currency(value: Decimal | str | int | float) -> str:
    decimal_value = Decimal(str(value))
    formatted = f"{decimal_value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{formatted} EUR"


def _status_label(status: str) -> str:
    if status == Invoice.Status.PAID:
        return "Εξοφλημένο"
    if status == Invoice.Status.ISSUED:
        return "Εκδομένο"
    return "Πρόχειρο"


def _payment_method_label(method: str) -> str:
    mapping = {
        PaymentRecord.Method.CASH: "Μετρητά",
        PaymentRecord.Method.BANK_TRANSFER: "Τραπεζική μεταφορά",
        PaymentRecord.Method.CARD: "Κάρτα",
        PaymentRecord.Method.OTHER: "Άλλο",
    }
    return mapping.get(method, method)


def _build_branded_pdf(
    *,
    document_title: str,
    document_subtitle: str,
    meta_left: list[str],
    meta_right: list[str],
    row_headers: list[str],
    rows: list[list[str]],
    totals: list[tuple[str, str]],
) -> bytes:
    normal_font, bold_font = _register_pdf_fonts()
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=14 * mm,
        rightMargin=14 * mm,
        topMargin=66 * mm,
        bottomMargin=18 * mm,
    )

    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="AppBody",
            fontName=normal_font,
            fontSize=9.2,
            leading=11.2,
            textColor=colors.HexColor("#1A2A53"),
        )
    )
    styles.add(
        ParagraphStyle(
            name="AppBodyBold",
            parent=styles["AppBody"],
            fontName=bold_font,
            fontSize=9.2,
        )
    )

    def p(text: str, *, bold=False) -> Paragraph:
        return Paragraph(text.replace("\n", "<br/>"), styles["AppBodyBold" if bold else "AppBody"])

    story = [Spacer(1, 2 * mm)]

    meta_table_data = [
        [p(meta_left[0], bold=True), p(meta_right[0], bold=True)],
        [p(meta_left[1]), p(meta_right[1])],
        [p(meta_left[2]), p(meta_right[2])],
    ]
    meta_table = Table(meta_table_data, colWidths=[88 * mm, 88 * mm])
    meta_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEF2FA")),
                ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#CBD7EE")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#D6E0F2")),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.extend([meta_table, Spacer(1, 8 * mm)])

    table_data = [row_headers] + rows
    main_table = Table(table_data, colWidths=[120 * mm, 56 * mm])
    main_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (-1, 0), bold_font),
                ("FONTNAME", (0, 1), (-1, -1), normal_font),
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2A4587")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#1A2A53")),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("ALIGN", (1, 0), (1, -1), "LEFT"),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#F7FAFF"), colors.HexColor("#EEF3FC")]),
                ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#CBD7EE")),
                ("INNERGRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#D6E0F2")),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend([main_table, Spacer(1, 8 * mm)])

    totals_table = Table([[label, value] for label, value in totals], colWidths=[120 * mm, 56 * mm])
    totals_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#1D2F5F")),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
                ("FONTNAME", (0, 0), (-1, -1), normal_font),
                ("FONTNAME", (0, 0), (-1, 0), bold_font),
                ("FONTNAME", (1, 0), (1, -1), bold_font),
                ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#3E5FA2")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#34528E")),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.append(totals_table)

    def draw_header(canvas, _doc):
        page_w, page_h = A4
        canvas.saveState()
        canvas.setFillColor(colors.HexColor("#0F1C36"))
        canvas.rect(14 * mm, page_h - 54 * mm, page_w - 28 * mm, 40 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#2A4587"))
        canvas.rect(14 * mm, page_h - 54 * mm, 60 * mm, 40 * mm, fill=1, stroke=0)
        canvas.setFillColor(colors.HexColor("#4B67D9"))
        canvas.rect(74 * mm, page_h - 54 * mm, page_w - 88 * mm, 40 * mm, fill=1, stroke=0)

        # Building outline logo.
        canvas.setStrokeColor(colors.white)
        canvas.setLineWidth(1.4)
        logo_x = 24 * mm
        logo_y = page_h - 48 * mm
        canvas.line(logo_x, logo_y + 15, logo_x, logo_y)
        canvas.line(logo_x, logo_y, logo_x + 9 * mm, logo_y - 4 * mm)
        canvas.line(logo_x + 9 * mm, logo_y - 4 * mm, logo_x + 18 * mm, logo_y)
        canvas.line(logo_x + 18 * mm, logo_y, logo_x + 18 * mm, logo_y + 15)
        canvas.line(logo_x + 5 * mm, logo_y + 6, logo_x + 13 * mm, logo_y + 6)
        canvas.line(logo_x + 5 * mm, logo_y + 6, logo_x + 5 * mm, logo_y - 2)
        canvas.line(logo_x + 13 * mm, logo_y + 6, logo_x + 13 * mm, logo_y - 2)

        canvas.setFillColor(colors.white)
        canvas.setFont(bold_font, 13)
        canvas.drawString(58 * mm, page_h - 27 * mm, "ΕΦΑΡΜΟΓΗ ΔΙΑΧΕΙΡΙΣΗΣ")
        canvas.setFont(bold_font, 11)
        canvas.drawString(58 * mm, page_h - 34 * mm, "ΜΕΤΑΜΟΡΦΩΣΕΩΣ 5")
        canvas.setFont(bold_font, 18)
        canvas.drawString(58 * mm, page_h - 43 * mm, document_title)
        canvas.setFont(normal_font, 9)
        canvas.drawString(58 * mm, page_h - 49 * mm, document_subtitle)

        canvas.setFillColor(colors.HexColor("#6B7EA8"))
        canvas.setFont(normal_font, 8)
        canvas.drawString(14 * mm, 10 * mm, "Παραγόμενο αρχείο από την ΕΦΑΡΜΟΓΗ ΔΙΑΧΕΙΡΙΣΗΣ")
        canvas.restoreState()

    doc.build(story, onFirstPage=draw_header, onLaterPages=draw_header)
    return buffer.getvalue()


def _create_receipt_pdf(invoice: Invoice, payment: PaymentRecord) -> tuple[str, bytes]:
    apartment_label = invoice.apartment.apartment_label
    meta_left = [
        f"Διαμέρισμα: {apartment_label}",
        f"Μήνας λογαριασμού: {invoice.month}",
        f"Ημερομηνία πληρωμής: {payment.payment_date.isoformat()}",
    ]
    meta_right = [
        f"Κατάσταση: {_status_label(invoice.status)}",
        f"Μέθοδος: {_payment_method_label(payment.method)}",
        f"Αναφορά: {payment.reference or '-'}",
    ]
    rows = [
        ["Πληρωθέν ποσό", _format_currency(payment.amount)],
        ["Υπόλοιπο μετά την πληρωμή", _format_currency(invoice.outstanding_balance)],
    ]
    totals = [
        ("Σύνολο απόδειξης", _format_currency(payment.amount)),
        ("Σύνολο λογαριασμού", _format_currency(invoice.invoice_total)),
        ("Υπόλοιπο", _format_currency(invoice.outstanding_balance)),
    ]
    pdf_bytes = _build_branded_pdf(
        document_title="ΑΠΟΔΕΙΞΗ ΠΛΗΡΩΜΗΣ",
        document_subtitle="Επίσημο έγγραφο εξόφλησης",
        meta_left=meta_left,
        meta_right=meta_right,
        row_headers=["Περιγραφή", "Ποσό"],
        rows=rows,
        totals=totals,
    )
    filename = f"receipt-{invoice.month}-{apartment_label}.pdf".replace(" ", "_")
    return filename, pdf_bytes


def _create_invoice_pdf(invoice: Invoice) -> tuple[str, bytes]:
    apartment_label = invoice.apartment.apartment_label
    meta_left = [
        f"Διαμέρισμα: {apartment_label}",
        f"Μήνας χρέωσης: {invoice.month}",
        f"Κατάσταση: {_status_label(invoice.status)}",
    ]
    meta_right = [
        f"Πληρωμένο: {_format_currency(invoice.paid_total)}",
        f"Υπόλοιπο: {_format_currency(invoice.outstanding_balance)}",
        "Τύπος: Μηνιαίος λογαριασμός",
    ]
    rows = [
        ["Καλοριφέρ", _format_currency(invoice.heating_radiators_total)],
        ["Ζεστό νερό", _format_currency(invoice.heated_water_energy_total)],
        ["Νερό", _format_currency(invoice.water_consumption_total)],
        ["Κοινόχρηστα", _format_currency(invoice.common_recurring_total)],
        ["Έκτακτα", _format_currency(invoice.common_non_recurring_total)],
        ["Μόνο ιδιοκτήτες", _format_currency(invoice.owners_only_total)],
    ]
    totals = [
        ("Σύνολο λογαριασμού", _format_currency(invoice.invoice_total)),
        ("Πληρωμένο", _format_currency(invoice.paid_total)),
        ("Υπόλοιπο", _format_currency(invoice.outstanding_balance)),
    ]
    pdf_bytes = _build_branded_pdf(
        document_title="ΜΗΝΙΑΙΟΣ ΛΟΓΑΡΙΑΣΜΟΣ",
        document_subtitle="Ανάλυση χρεώσεων διαμερίσματος",
        meta_left=meta_left,
        meta_right=meta_right,
        row_headers=["Κατηγορία χρέωσης", "Ποσό"],
        rows=rows,
        totals=totals,
    )
    filename = f"invoice-{invoice.month}-{apartment_label}.pdf".replace(" ", "_")
    return filename, pdf_bytes


def _send_receipt_email(invoice: Invoice, payment: PaymentRecord, receipt_filename: str, receipt_pdf: bytes, *, force=False):
    if not force:
        already_sent = NotificationDispatch.objects.filter(
            invoice=invoice,
            payment=payment,
            notification_type=NotificationDispatch.NotificationType.RECEIPT_PAID,
            status=NotificationDispatch.Status.SENT,
        ).exists()
        if already_sent:
            return None

    recipient_emails = list(
        invoice.apartment.memberships.exclude(user__email="").values_list("user__email", flat=True).distinct()
    )
    if not recipient_emails:
        return NotificationDispatch.objects.create(
            invoice=invoice,
            payment=payment,
            notification_type=NotificationDispatch.NotificationType.RECEIPT_PAID,
            status=NotificationDispatch.Status.SKIPPED,
            error_message="Δεν υπάρχουν email παραληπτών για το διαμέρισμα.",
        )

    subject = f"Απόδειξη πληρωμής λογαριασμού {invoice.month}"
    body = (
        f"Η πληρωμή για το διαμέρισμα {invoice.apartment.apartment_label} καταχωρίστηκε.\n"
        f"Ποσό: {payment.amount}\n"
        f"Ημερομηνία πληρωμής: {payment.payment_date.isoformat()}\n"
        f"Υπόλοιπο: {invoice.outstanding_balance}\n"
    )
    dispatch = NotificationDispatch.objects.create(
        invoice=invoice,
        payment=payment,
        notification_type=NotificationDispatch.NotificationType.RECEIPT_PAID,
        recipient_email=",".join(recipient_emails),
        status=NotificationDispatch.Status.QUEUED,
    )
    try:
        message = EmailMessage(subject=subject, body=body, to=recipient_emails)
        message.attach(receipt_filename, receipt_pdf, "application/pdf")
        message.send(fail_silently=False)
        dispatch.status = NotificationDispatch.Status.SENT
        dispatch.sent_at = timezone.now()
        dispatch.save(update_fields=["status", "sent_at"])
    except Exception as exc:  # pragma: no cover - tested via status path
        dispatch.status = NotificationDispatch.Status.FAILED
        dispatch.error_message = str(exc)
        dispatch.save(update_fields=["status", "error_message"])
    return dispatch


def _measurement_context_for_expense(building_apartments, expense: ExpenseItem, month: str):
    apartment_ids = [apartment.id for apartment in building_apartments]
    heating_qs = HeatingMeasurementInput.objects.filter(apartment_id__in=apartment_ids)
    water_qs = HeatedWaterMeasurementInput.objects.filter(apartment_id__in=apartment_ids)

    if expense.affected_period_start and expense.affected_period_end:
        # Use closest boundary readings for the selected range:
        # consumption = reading(closest to end) - reading(closest to start).
        heating_by_apartment: dict[int, list[HeatingMeasurementInput]] = {apartment.id: [] for apartment in building_apartments}
        for item in heating_qs.order_by("measurement_date", "id"):
            heating_by_apartment[item.apartment_id].append(item)

        water_by_apartment: dict[int, list[HeatedWaterMeasurementInput]] = {apartment.id: [] for apartment in building_apartments}
        for item in water_qs.order_by("measurement_date", "id"):
            water_by_apartment[item.apartment_id].append(item)

        apartment_units = {apartment.id: Decimal("0") for apartment in building_apartments}
        apartment_fixed = {apartment.id: Decimal("0") for apartment in building_apartments}
        volume_map = {apartment.id: Decimal("0") for apartment in building_apartments}

        start_date = expense.affected_period_start
        end_date = expense.affected_period_end

        for apartment in building_apartments:
            heating_rows = heating_by_apartment.get(apartment.id, [])
            if heating_rows:
                start_h = min(heating_rows, key=lambda row: abs((row.measurement_date - start_date).days))
                end_h = min(heating_rows, key=lambda row: abs((row.measurement_date - end_date).days))
                units_delta = Decimal(end_h.current_reading) - Decimal(start_h.current_reading)
                apartment_units[apartment.id] = units_delta if units_delta > Decimal("0") else Decimal("0")
                apartment_fixed[apartment.id] = Decimal(end_h.f_factor) * Decimal(end_h.e_factor)

            water_rows = water_by_apartment.get(apartment.id, [])
            if water_rows:
                start_w = min(water_rows, key=lambda row: abs((row.measurement_date - start_date).days))
                end_w = min(water_rows, key=lambda row: abs((row.measurement_date - end_date).days))
                volume_delta = Decimal(end_w.current_reading) - Decimal(start_w.current_reading)
                volume_map[apartment.id] = volume_delta if volume_delta > Decimal("0") else Decimal("0")

        sum_units = sum(apartment_units.values(), Decimal("0"))
        sum_fixed = sum(apartment_fixed.values(), Decimal("0"))
        if sum_fixed < Decimal("0") or sum_fixed > Decimal("1"):
            return None, (
                f"Μη έγκυροι συντελεστές θέρμανσης για το κτίριο {building_apartments[0].building_id}: "
                "Το άθροισμα(fi*ei) πρέπει να είναι μεταξύ 0 και 1."
            )

        radiator_share_map = {apartment.id: Decimal("0") for apartment in building_apartments}
        if sum_units > Decimal("0"):
            for apartment in building_apartments:
                units = apartment_units.get(apartment.id, Decimal("0"))
                fixed_component = apartment_fixed.get(apartment.id, Decimal("0"))
                variable_component = (units / sum_units) * (Decimal("1") - sum_fixed)
                radiator_share_map[apartment.id] = fixed_component + variable_component

        share_sum = sum(radiator_share_map.values(), Decimal("0"))
        if share_sum > Decimal("0"):
            for apartment_id in radiator_share_map.keys():
                radiator_share_map[apartment_id] = radiator_share_map[apartment_id] / share_sum

        total_volume = sum(volume_map.values(), Decimal("0"))
        return {
            "radiator_share_map": radiator_share_map,
            "volume_map": volume_map,
            "total_volume": total_volume,
        }, None
    else:
        year, month_no = parse_month(month)
        heating_qs = heating_qs.filter(measurement_date__year=year, measurement_date__month=month_no)
        water_qs = water_qs.filter(measurement_date__year=year, measurement_date__month=month_no)

    apartment_units = {apartment.id: Decimal("0") for apartment in building_apartments}
    apartment_fixed = {apartment.id: Decimal("0") for apartment in building_apartments}
    for heating_input in heating_qs.order_by("-measurement_date", "-id"):
        apartment_units[heating_input.apartment_id] += Decimal(heating_input.units_counted)
        if apartment_fixed[heating_input.apartment_id] == Decimal("0"):
            apartment_fixed[heating_input.apartment_id] = Decimal(heating_input.f_factor) * Decimal(heating_input.e_factor)

    sum_units = sum(apartment_units.values(), Decimal("0"))
    sum_fixed = sum(apartment_fixed.values(), Decimal("0"))
    if sum_fixed < Decimal("0") or sum_fixed > Decimal("1"):
        return None, (
            f"Μη έγκυροι συντελεστές θέρμανσης για το κτίριο {building_apartments[0].building_id}: "
            "Το άθροισμα(fi*ei) πρέπει να είναι μεταξύ 0 και 1."
        )

    radiator_share_map = {apartment.id: Decimal("0") for apartment in building_apartments}
    if sum_units > Decimal("0"):
        for apartment in building_apartments:
            units = apartment_units.get(apartment.id, Decimal("0"))
            fixed_component = apartment_fixed.get(apartment.id, Decimal("0"))
            variable_component = (units / sum_units) * (Decimal("1") - sum_fixed)
            radiator_share_map[apartment.id] = fixed_component + variable_component

    share_sum = sum(radiator_share_map.values(), Decimal("0"))
    if share_sum > Decimal("0"):
        for apartment_id in radiator_share_map.keys():
            radiator_share_map[apartment_id] = radiator_share_map[apartment_id] / share_sum

    volume_map = {apartment.id: Decimal("0") for apartment in building_apartments}
    for water_input in water_qs:
        volume_map[water_input.apartment_id] += Decimal(water_input.computed_heating_water_volume)
    total_volume = sum(volume_map.values(), Decimal("0"))

    return {
        "radiator_share_map": radiator_share_map,
        "volume_map": volume_map,
        "total_volume": total_volume,
    }, None


def _calculate_invoice_rows(month: str):
    apartments = list(Apartment.objects.select_related("building").all().order_by("unit_code"))
    if not apartments:
        return None, {"detail": "Δεν βρέθηκαν διαμερίσματα."}

    recurring_categories = {
        ExpenseItem.Category.GARDENER,
        ExpenseItem.Category.COMMON_POWER,
        ExpenseItem.Category.COMMON_WATER,
        ExpenseItem.Category.CLEANING,
        ExpenseItem.Category.ELEVATOR,
    }
    non_recurring_categories = {
        ExpenseItem.Category.DAMAGES,
        ExpenseItem.Category.ANNUAL_SERVICING,
        ExpenseItem.Category.OTHER,
    }
    owners_only_categories = {
        ExpenseItem.Category.OWNERS_ONLY,
    }

    expenses_by_building = {}
    for expense in ExpenseItem.objects.filter(month=month):
        expenses_by_building.setdefault(expense.building_id, []).append(expense)

    apartments_by_building = {}
    for apartment in apartments:
        apartments_by_building.setdefault(apartment.building_id, []).append(apartment)

    measurement_context_cache = {}
    rows = {}
    for apartment in apartments:
        rows[apartment.id] = {
            "heating_radiators_total": Decimal("0"),
            "heated_water_energy_total": Decimal("0"),
            "water_consumption_total": Decimal("0"),
            "common_recurring_total": Decimal("0"),
            "common_non_recurring_total": Decimal("0"),
            "owners_only_total": Decimal("0"),
        }

    for building_id, building_apartments in apartments_by_building.items():
        for expense in expenses_by_building.get(building_id, []):
            if expense.expense_category in (
                ExpenseItem.Category.GAS_HEATING,
                ExpenseItem.Category.WATER_HW_CONSUMPTION,
                ExpenseItem.Category.GAS_HW_CONSUMPTION,
            ):
                cache_key = (
                    building_id,
                    str(expense.affected_period_start or ""),
                    str(expense.affected_period_end or ""),
                    month,
                )
                if cache_key not in measurement_context_cache:
                    context, error_message = _measurement_context_for_expense(building_apartments, expense, month)
                    if error_message:
                        return None, {"detail": error_message}
                    measurement_context_cache[cache_key] = context
                context = measurement_context_cache[cache_key]
            else:
                context = None

            expense_amount = Decimal(expense.amount)
            for apartment in building_apartments:
                ownership_fraction = Decimal(apartment.ownership_permille) / Decimal("1000")
                if expense.expense_category == ExpenseItem.Category.GAS_HEATING:
                    radiator_share_map = context["radiator_share_map"]
                    rows[apartment.id]["heating_radiators_total"] += expense_amount * radiator_share_map.get(
                        apartment.id, Decimal("0")
                    )
                elif expense.expense_category == ExpenseItem.Category.WATER_HW_CONSUMPTION:
                    volume_map = context["volume_map"]
                    total_volume = context["total_volume"]
                    if total_volume > Decimal("0"):
                        rows[apartment.id]["water_consumption_total"] += expense_amount * (
                            volume_map.get(apartment.id, Decimal("0")) / total_volume
                        )
                elif expense.expense_category == ExpenseItem.Category.GAS_HW_CONSUMPTION:
                    volume_map = context["volume_map"]
                    total_volume = context["total_volume"]
                    if total_volume > Decimal("0"):
                        rows[apartment.id]["heated_water_energy_total"] += expense_amount * (
                            volume_map.get(apartment.id, Decimal("0")) / total_volume
                        )
                elif expense.expense_category in recurring_categories:
                    rows[apartment.id]["common_recurring_total"] += expense_amount * ownership_fraction
                elif expense.expense_category in non_recurring_categories:
                    rows[apartment.id]["common_non_recurring_total"] += expense_amount * ownership_fraction
                elif expense.expense_category in owners_only_categories:
                    rows[apartment.id]["owners_only_total"] += expense_amount * ownership_fraction

    return (apartments, rows), None


class ApartmentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ApartmentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role in ("superadmin", "administrator"):
            return Apartment.objects.select_related("building").all().order_by("unit_code")
        return Apartment.objects.select_related("building").filter(memberships__user=user).distinct().order_by("unit_code")

    @action(methods=["patch"], detail=True, url_path="heating-factors")
    def heating_factors(self, request, pk=None):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        apartment = self.get_object()
        serializer = ApartmentHeatingFactorsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        apartment.heating_e_factor = serializer.validated_data["heating_e_factor"]
        apartment.heating_f_factor = serializer.validated_data["heating_f_factor"]
        apartment.save(update_fields=["heating_e_factor", "heating_f_factor", "updated_at"])
        return Response(ApartmentSerializer(apartment).data, status=status.HTTP_200_OK)


class AdminWriteRequiredMixin:
    def is_admin_write(self):
        return self.request.user.role in ("superadmin", "administrator")


def _visible_apartments_for_measurements(user):
    apartments = Apartment.objects.select_related("building")
    if user.role in ("superadmin", "administrator"):
        return apartments.order_by("unit_code")
    user_building_ids = ApartmentUser.objects.filter(user=user).values_list("apartment__building_id", flat=True)
    return apartments.filter(building_id__in=user_building_ids).distinct().order_by("unit_code")


class HeatingMeasurementInputViewSet(AdminWriteRequiredMixin, viewsets.ModelViewSet):
    serializer_class = HeatingMeasurementInputSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = HeatingMeasurementInput.objects.select_related("apartment", "apartment__building").all()
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-measurement_date", "apartment__unit_code")
        user_building_ids = ApartmentUser.objects.filter(user=user).values_list("apartment__building_id", flat=True)
        return queryset.filter(apartment__building_id__in=user_building_ids).distinct().order_by(
            "-measurement_date", "apartment__unit_code"
        )

    def create(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    @action(methods=["get"], detail=False, url_path="dates")
    def dates(self, request):
        user = request.user
        apartments = _visible_apartments_for_measurements(user)
        apartment_ids = list(apartments.values_list("id", flat=True))

        heating_dates = set(
            HeatingMeasurementInput.objects.filter(apartment_id__in=apartment_ids).values_list("measurement_date", flat=True)
        )
        water_dates = set(
            HeatedWaterMeasurementInput.objects.filter(apartment_id__in=apartment_ids).values_list("measurement_date", flat=True)
        )
        measurement_dates = sorted(heating_dates | water_dates, reverse=True)

        items = []
        for measurement_date in measurement_dates:
            heating_count = HeatingMeasurementInput.objects.filter(
                apartment_id__in=apartment_ids, measurement_date=measurement_date
            ).count()
            water_count = HeatedWaterMeasurementInput.objects.filter(
                apartment_id__in=apartment_ids, measurement_date=measurement_date
            ).count()
            items.append(
                {
                    "measurement_date": measurement_date,
                    "heating_entries": heating_count,
                    "heated_water_entries": water_count,
                    "apartments_total": len(apartment_ids),
                }
            )

        suggested_date = date_after(measurement_dates[0]) if measurement_dates else timezone.now().date()

        return Response({"items": items, "suggested_next_date": suggested_date}, status=status.HTTP_200_OK)

    @action(methods=["get"], detail=False, url_path="entry-form")
    def entry_form(self, request):
        measurement_date = request.query_params.get("measurement_date")
        user = request.user
        apartments = _visible_apartments_for_measurements(user)

        all_dates = sorted(
            set(HeatingMeasurementInput.objects.filter(apartment__in=apartments).values_list("measurement_date", flat=True))
            | set(
                HeatedWaterMeasurementInput.objects.filter(apartment__in=apartments).values_list(
                    "measurement_date", flat=True
                )
            ),
            reverse=True,
        )
        if not measurement_date:
            measurement_date = date_after(all_dates[0]).isoformat() if all_dates else timezone.now().date().isoformat()

        rows = []
        for apartment in apartments:
            prev_heating = (
                HeatingMeasurementInput.objects.filter(apartment=apartment, measurement_date__lt=measurement_date)
                .order_by("-measurement_date")
                .first()
            )
            prev_water = (
                HeatedWaterMeasurementInput.objects.filter(apartment=apartment, measurement_date__lt=measurement_date)
                .order_by("-measurement_date")
                .first()
            )
            rows.append(
                {
                    "apartment_id": apartment.id,
                    "apartment_label": apartment.apartment_label,
                    "building_name": apartment.building.name,
                    "previous_heating_reading": str(prev_heating.current_reading if prev_heating else Decimal("0")),
                    "previous_heated_water_reading": str(prev_water.current_reading if prev_water else Decimal("0")),
                }
            )

        return Response({"measurement_date": measurement_date, "rows": rows}, status=status.HTTP_200_OK)

    @action(methods=["get"], detail=False, url_path="date-detail")
    def date_detail(self, request):
        measurement_date = request.query_params.get("measurement_date")
        if not measurement_date:
            return Response({"detail": "Λείπει παράμετρος measurement_date."}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        apartments = _visible_apartments_for_measurements(user)

        heating_map = {
            item.apartment_id: item
            for item in HeatingMeasurementInput.objects.filter(apartment__in=apartments, measurement_date=measurement_date)
        }
        water_map = {
            item.apartment_id: item
            for item in HeatedWaterMeasurementInput.objects.filter(apartment__in=apartments, measurement_date=measurement_date)
        }

        rows = []
        for apartment in apartments:
            heating_item = heating_map.get(apartment.id)
            water_item = water_map.get(apartment.id)
            prev_heating = (
                HeatingMeasurementInput.objects.filter(apartment=apartment, measurement_date__lt=measurement_date)
                .order_by("-measurement_date")
                .first()
            )
            prev_water = (
                HeatedWaterMeasurementInput.objects.filter(apartment=apartment, measurement_date__lt=measurement_date)
                .order_by("-measurement_date")
                .first()
            )
            rows.append(
                {
                    "apartment_id": apartment.id,
                    "apartment_label": apartment.apartment_label,
                    "building_name": apartment.building.name,
                    "previous_heating_reading": str(prev_heating.current_reading if prev_heating else Decimal("0")),
                    "heating_current_reading": str(heating_item.current_reading if heating_item else ""),
                    "heating_units_counted": str(heating_item.units_counted if heating_item else ""),
                    "previous_heated_water_reading": str(prev_water.current_reading if prev_water else Decimal("0")),
                    "heated_water_current_reading": str(water_item.current_reading if water_item else ""),
                    "heated_water_units_counted": str(water_item.computed_heating_water_volume if water_item else ""),
                }
            )
        return Response({"measurement_date": measurement_date, "rows": rows}, status=status.HTTP_200_OK)

    @action(methods=["post"], detail=False, url_path="monthly-upsert")
    def monthly_upsert(self, request):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = MonthlyMeasurementUpsertSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        rows = data["rows"]
        apartment_ids = {row["apartment_id"] for row in rows}
        apartments = {
            apartment.id: apartment
            for apartment in Apartment.objects.filter(id__in=apartment_ids).select_related("building")
        }

        missing_ids = sorted(list(apartment_ids - set(apartments.keys())))
        if missing_ids:
            return Response(
                {"detail": f"Μη έγκυρα αναγνωριστικά διαμερισμάτων: {missing_ids}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        missing_factors = [
            apt.apartment_label
            for apt in apartments.values()
            if apt.heating_e_factor is None or apt.heating_f_factor is None
        ]
        if missing_factors:
            return Response(
                {"detail": f"Λείπουν συντελεστές θέρμανσης διαμερισμάτων (e/f): {', '.join(sorted(missing_factors))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_count = 0
        updated_count = 0
        with transaction.atomic():
            for row in rows:
                apartment = apartments[row["apartment_id"]]
                e = Decimal(apartment.heating_e_factor)
                f = Decimal(apartment.heating_f_factor)

                prev_heating = (
                    HeatingMeasurementInput.objects.filter(
                        apartment=apartment, measurement_date__lt=data["measurement_date"]
                    )
                    .order_by("-measurement_date")
                    .first()
                )
                prev_heating_reading = Decimal(prev_heating.current_reading) if prev_heating else Decimal("0")
                current_heating_reading = q1(Decimal(row["heating_current_reading"]))
                heating_units = q1(current_heating_reading - prev_heating_reading)
                if heating_units < Decimal("0"):
                    return Response(
                        {"detail": f"Αρνητική κατανάλωση θέρμανσης στο διαμέρισμα {apartment.apartment_label}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                prev_water = (
                    HeatedWaterMeasurementInput.objects.filter(
                        apartment=apartment, measurement_date__lt=data["measurement_date"]
                    )
                    .order_by("-measurement_date")
                    .first()
                )
                prev_water_reading = Decimal(prev_water.current_reading) if prev_water else Decimal("0")
                current_water_reading = q1(Decimal(row["heated_water_current_reading"]))
                water_units = q1(current_water_reading - prev_water_reading)
                if water_units < Decimal("0"):
                    return Response(
                        {"detail": f"Αρνητική κατανάλωση θερμού νερού στο διαμέρισμα {apartment.apartment_label}."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

                heating_defaults = {
                    "billing_period_start": data["billing_period_start"],
                    "billing_period_end": data["billing_period_end"],
                    "e_factor": e,
                    "f_factor": f,
                    "current_reading": current_heating_reading,
                    "units_counted": heating_units,
                    "computed_radiator_heating_energy": e * f,
                    "created_by_user": request.user,
                }
                _, heating_created = HeatingMeasurementInput.objects.update_or_create(
                    apartment=apartment,
                    measurement_date=data["measurement_date"],
                    defaults=heating_defaults,
                )

                water_defaults = {
                    "billing_period_start": data["billing_period_start"],
                    "billing_period_end": data["billing_period_end"],
                    "current_reading": current_water_reading,
                    "computed_heating_water_volume": water_units,
                    "created_by_user": request.user,
                }
                _, water_created = HeatedWaterMeasurementInput.objects.update_or_create(
                    apartment=apartment,
                    measurement_date=data["measurement_date"],
                    defaults=water_defaults,
                )
                if heating_created and water_created:
                    created_count += 1
                else:
                    updated_count += 1

        return Response(
            {
                "detail": f"Οι μετρήσεις αποθηκεύτηκαν για την ημερομηνία {data['measurement_date']}.",
                "created": created_count,
                "updated": updated_count,
                "rows": len(rows),
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["post"], detail=False, url_path="bulk-upsert")
    def bulk_upsert(self, request):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = HeatingBulkUpsertSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        rows = data["rows"]
        apartment_ids = {row["apartment_id"] for row in rows}
        apartments = {
            apartment.id: apartment
            for apartment in Apartment.objects.filter(id__in=apartment_ids).select_related("building")
        }
        missing_ids = sorted(list(apartment_ids - set(apartments.keys())))
        if missing_ids:
            return Response(
                {"detail": f"Μη έγκυρα αναγνωριστικά διαμερισμάτων: {missing_ids}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        missing_factors = [
            apt.apartment_label
            for apt in apartments.values()
            if apt.heating_e_factor is None or apt.heating_f_factor is None
        ]
        if missing_factors:
            return Response(
                {"detail": f"Λείπουν συντελεστές θέρμανσης διαμερισμάτων (e/f): {', '.join(sorted(missing_factors))}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_count = 0
        updated_count = 0
        with transaction.atomic():
            for row in rows:
                apartment = apartments[row["apartment_id"]]
                e = Decimal(apartment.heating_e_factor)
                f = Decimal(apartment.heating_f_factor)
                defaults = {
                    "billing_period_start": data["billing_period_start"],
                    "billing_period_end": data["billing_period_end"],
                    "e_factor": e,
                    "f_factor": f,
                    "units_counted": q1(Decimal(row["units_counted"])),
                    "computed_radiator_heating_energy": e * f,
                    "created_by_user": request.user,
                }
                _, created = HeatingMeasurementInput.objects.update_or_create(
                    apartment=apartment,
                    measurement_date=data["measurement_date"],
                    defaults=defaults,
                )
                if created:
                    created_count += 1
                else:
                    updated_count += 1

        return Response(
            {
                "detail": f"Οι μετρήσεις θέρμανσης αποθηκεύτηκαν για την ημερομηνία {data['measurement_date']}.",
                "created": created_count,
                "updated": updated_count,
                "rows": len(rows),
            },
            status=status.HTTP_200_OK,
        )


class HeatedWaterMeasurementInputViewSet(AdminWriteRequiredMixin, viewsets.ModelViewSet):
    serializer_class = HeatedWaterMeasurementInputSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = HeatedWaterMeasurementInput.objects.select_related("apartment", "apartment__building").all()
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-measurement_date", "apartment__unit_code")
        user_building_ids = ApartmentUser.objects.filter(user=user).values_list("apartment__building_id", flat=True)
        return queryset.filter(apartment__building_id__in=user_building_ids).distinct().order_by(
            "-measurement_date", "apartment__unit_code"
        )

    def create(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)

    @action(methods=["post"], detail=False, url_path="bulk-upsert")
    def bulk_upsert(self, request):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = HeatedWaterBulkUpsertSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        data = input_serializer.validated_data
        rows = data["rows"]
        apartment_ids = {row["apartment_id"] for row in rows}
        apartments = {
            apartment.id: apartment
            for apartment in Apartment.objects.filter(id__in=apartment_ids).select_related("building")
        }
        missing_ids = sorted(list(apartment_ids - set(apartments.keys())))
        if missing_ids:
            return Response(
                {"detail": f"Μη έγκυρα αναγνωριστικά διαμερισμάτων: {missing_ids}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        created_count = 0
        updated_count = 0
        with transaction.atomic():
            for row in rows:
                apartment = apartments[row["apartment_id"]]
                defaults = {
                    "billing_period_start": data["billing_period_start"],
                    "billing_period_end": data["billing_period_end"],
                    "inputs_json": row.get("inputs_json", {}),
                    "computed_heating_water_volume": q1(Decimal(row["computed_heating_water_volume"])),
                    "created_by_user": request.user,
                }
                _, created = HeatedWaterMeasurementInput.objects.update_or_create(
                    apartment=apartment,
                    measurement_date=data["measurement_date"],
                    defaults=defaults,
                )
                if created:
                    created_count += 1
                else:
                    updated_count += 1

        return Response(
            {
                "detail": f"Οι μετρήσεις θερμού νερού αποθηκεύτηκαν για την ημερομηνία {data['measurement_date']}.",
                "created": created_count,
                "updated": updated_count,
                "rows": len(rows),
            },
            status=status.HTTP_200_OK,
        )


class ExpenseItemViewSet(AdminWriteRequiredMixin, viewsets.ModelViewSet):
    serializer_class = ExpenseItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = ExpenseItem.objects.select_related("building").all()
        month = self.request.query_params.get("month")
        if month:
            queryset = queryset.filter(month=month)
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-expense_date", "id")
        allowed_building_ids = Apartment.objects.filter(memberships__user=user).values_list("building_id", flat=True).distinct()
        return queryset.filter(building_id__in=allowed_building_ids).order_by("-expense_date", "id")

    def create(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        return super().partial_update(request, *args, **kwargs)


class InvoiceViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = Invoice.objects.select_related("apartment", "apartment__building").all()
        month = self.request.query_params.get("month")
        building_scope = self.request.query_params.get("building_scope")
        personal_scope = self.request.query_params.get("personal_scope")
        if month:
            queryset = queryset.filter(month=month)
        if personal_scope in ("1", "true", "yes"):
            return queryset.filter(apartment__memberships__user=user).distinct().order_by("-month", "apartment__unit_code")
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-month", "apartment__unit_code")
        if building_scope in ("1", "true", "yes"):
            user_building_ids = ApartmentUser.objects.filter(user=user).values_list("apartment__building_id", flat=True)
            return (
                queryset.filter(apartment__building_id__in=user_building_ids)
                .distinct()
                .order_by("-month", "apartment__unit_code")
            )
        return queryset.filter(apartment__memberships__user=user).distinct().order_by("-month", "apartment__unit_code")

    @action(methods=["get"], detail=False, url_path="preview")
    def preview(self, request):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        month = request.query_params.get("month")
        if not month:
            return Response({"detail": "Λείπει παράμετρος month."}, status=status.HTTP_400_BAD_REQUEST)

        input_serializer = InvoiceGenerateSerializer(data={"month": month})
        input_serializer.is_valid(raise_exception=True)
        month = input_serializer.validated_data["month"]

        result, error = _calculate_invoice_rows(month)
        if error:
            return Response(error, status=status.HTTP_400_BAD_REQUEST)
        apartments, rows = result

        preview_items = []
        for apartment in apartments:
            data = rows[apartment.id]
            invoice_total = q2(
                data["heating_radiators_total"]
                + data["heated_water_energy_total"]
                + data["water_consumption_total"]
                + data["common_recurring_total"]
                + data["common_non_recurring_total"]
                + data["owners_only_total"]
            )
            preview_items.append(
                {
                    "apartment": apartment.id,
                    "apartment_unit_code": apartment.apartment_label,
                    "month": month,
                    "heating_radiators_total": q2(data["heating_radiators_total"]),
                    "heated_water_energy_total": q2(data["heated_water_energy_total"]),
                    "water_consumption_total": q2(data["water_consumption_total"]),
                    "common_recurring_total": q2(data["common_recurring_total"]),
                    "common_non_recurring_total": q2(data["common_non_recurring_total"]),
                    "owners_only_total": q2(data["owners_only_total"]),
                    "invoice_total": invoice_total,
                }
            )

        return Response({"month": month, "items": preview_items}, status=status.HTTP_200_OK)

    @action(methods=["get"], detail=False, url_path="analysis-share")
    def analysis_share(self, request):
        month = request.query_params.get("month")
        if not month:
            return Response({"detail": "Λείπει παράμετρος month."}, status=status.HTTP_400_BAD_REQUEST)

        all_month_invoices = (
            Invoice.objects.select_related("apartment")
            .filter(month=month)
            .order_by("apartment__unit_code")
        )
        total = sum((invoice.invoice_total for invoice in all_month_invoices), Decimal("0.00"))
        items = []
        for invoice in all_month_invoices:
            invoice_total = Decimal(invoice.invoice_total or Decimal("0.00"))
            share_percent = Decimal("0.00")
            if total > 0:
                share_percent = q2((invoice_total * Decimal("100.00")) / total)
            items.append(
                {
                    "invoice_id": invoice.id,
                    "apartment_id": invoice.apartment_id,
                    "apartment_unit_code": invoice.apartment.unit_code,
                    "invoice_total": q2(invoice_total),
                    "share_percent": share_percent,
                }
            )

        return Response(
            {
                "month": month,
                "total_invoice_amount": q2(total),
                "items": items,
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["post"], detail=False, url_path="generate")
    def generate(self, request):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)

        input_serializer = InvoiceGenerateSerializer(data=request.data)
        input_serializer.is_valid(raise_exception=True)
        month = input_serializer.validated_data["month"]
        result, error = _calculate_invoice_rows(month)
        if error:
            return Response(error, status=status.HTTP_400_BAD_REQUEST)
        apartments, rows = result

        with transaction.atomic():
            for apartment in apartments:
                data = rows[apartment.id]
                invoice_total = q2(
                    data["heating_radiators_total"]
                    + data["heated_water_energy_total"]
                    + data["water_consumption_total"]
                    + data["common_recurring_total"]
                    + data["common_non_recurring_total"]
                    + data["owners_only_total"]
                )

                invoice, _created = Invoice.objects.get_or_create(apartment=apartment, month=month)
                invoice.heating_radiators_total = q2(data["heating_radiators_total"])
                invoice.heated_water_energy_total = q2(data["heated_water_energy_total"])
                invoice.water_consumption_total = q2(data["water_consumption_total"])
                invoice.common_recurring_total = q2(data["common_recurring_total"])
                invoice.common_non_recurring_total = q2(data["common_non_recurring_total"])
                invoice.owners_only_total = q2(data["owners_only_total"])
                invoice.invoice_total = invoice_total
                if invoice.paid_total > invoice_total:
                    invoice.paid_total = invoice_total
                invoice.outstanding_balance = q2(invoice.invoice_total - invoice.paid_total)
                invoice.status = Invoice.Status.ISSUED
                invoice.issued_at = timezone.now()
                invoice.save()

        return Response({"detail": f"Οι λογαριασμοί δημιουργήθηκαν για τον μήνα {month}."}, status=status.HTTP_200_OK)

    @action(methods=["post"], detail=True, url_path="mark-paid")
    def mark_paid(self, request, pk=None):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        invoice = self.get_object()
        serializer = InvoiceMarkPaidSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if invoice.outstanding_balance <= Decimal("0"):
            return Response({"detail": "Ο λογαριασμός είναι ήδη εξοφλημένος."}, status=status.HTTP_400_BAD_REQUEST)

        payment_amount = data.get("amount", invoice.outstanding_balance)
        payment_date = data.get("payment_date", timezone.now().date())
        if payment_amount <= Decimal("0"):
            return Response({"detail": "Το ποσό πληρωμής πρέπει να είναι θετικό."}, status=status.HTTP_400_BAD_REQUEST)
        if payment_amount > invoice.outstanding_balance:
            return Response({"detail": "Το ποσό πληρωμής δεν μπορεί να υπερβαίνει το υπόλοιπο."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            payment = PaymentRecord.objects.create(
                invoice=invoice,
                apartment=invoice.apartment,
                amount=q2(Decimal(payment_amount)),
                payment_date=payment_date,
                method=data.get("method", PaymentRecord.Method.BANK_TRANSFER),
                reference=data.get("reference", ""),
                notes=data.get("notes", ""),
                created_by_user=request.user,
            )
            invoice.paid_total = q2(Decimal(invoice.paid_total) + Decimal(payment.amount))
            invoice.outstanding_balance = q2(Decimal(invoice.invoice_total) - Decimal(invoice.paid_total))
            invoice.status = Invoice.Status.PAID if invoice.outstanding_balance <= Decimal("0") else Invoice.Status.ISSUED
            invoice.save(update_fields=["paid_total", "outstanding_balance", "status", "updated_at"])

            receipt_filename, receipt_pdf = _create_receipt_pdf(invoice, payment)
            document = InvoiceDocument.objects.create(
                invoice=invoice,
                payment=payment,
                document_type=InvoiceDocument.DocumentType.RECEIPT,
                file_name=receipt_filename,
                mime_type="application/pdf",
                content=receipt_pdf,
            )
            dispatch = _send_receipt_email(invoice, payment, receipt_filename, receipt_pdf)

        return Response(
            {
                "detail": "Η πληρωμή καταχωρίστηκε και δημιουργήθηκε απόδειξη.",
                "invoice": InvoiceSerializer(invoice).data,
                "payment": PaymentRecordSerializer(payment).data,
                "receipt_document_id": document.id,
                "notification_status": dispatch.status if dispatch else NotificationDispatch.Status.SENT,
            },
            status=status.HTTP_200_OK,
        )

    @action(methods=["post"], detail=True, url_path="send-receipt")
    def send_receipt(self, request, pk=None):
        if request.user.role not in ("superadmin", "administrator"):
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        invoice = self.get_object()
        payment_id = request.data.get("payment_id")
        force = bool(request.data.get("force", False))

        payments = invoice.payments.order_by("-created_at")
        if payment_id:
            payments = payments.filter(id=payment_id)
        payment = payments.first()
        if not payment:
            return Response({"detail": "Δεν βρέθηκε πληρωμή για αποστολή απόδειξης."}, status=status.HTTP_400_BAD_REQUEST)

        doc = (
            invoice.documents.filter(payment=payment, document_type=InvoiceDocument.DocumentType.RECEIPT)
            .order_by("-created_at")
            .first()
        )
        if doc:
            receipt_filename = doc.file_name
            receipt_pdf = bytes(doc.content)
        else:
            receipt_filename, receipt_pdf = _create_receipt_pdf(invoice, payment)
            InvoiceDocument.objects.create(
                invoice=invoice,
                payment=payment,
                document_type=InvoiceDocument.DocumentType.RECEIPT,
                file_name=receipt_filename,
                mime_type="application/pdf",
                content=receipt_pdf,
            )

        dispatch = _send_receipt_email(invoice, payment, receipt_filename, receipt_pdf, force=force)
        if dispatch is None:
            return Response(
                {"detail": "Η απόδειξη έχει ήδη σταλεί. Χρησιμοποιήστε force=true για επαναποστολή."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response({"detail": "Η αποστολή απόδειξης ολοκληρώθηκε.", "notification_status": dispatch.status})

    @action(methods=["get"], detail=True, url_path="download-pdf")
    def download_pdf(self, request, pk=None):
        invoice = self.get_object()
        filename, invoice_pdf = _create_invoice_pdf(invoice)
        response = HttpResponse(invoice_pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response

    @action(methods=["get"], detail=True, url_path="download-receipt")
    def download_receipt(self, request, pk=None):
        invoice = self.get_object()
        payment = invoice.payments.order_by("-created_at").first()
        if not payment:
            return Response({"detail": "Δεν βρέθηκε απόδειξη για αυτόν τον λογαριασμό."}, status=status.HTTP_404_NOT_FOUND)

        receipt_filename, receipt_pdf = _create_receipt_pdf(invoice, payment)
        InvoiceDocument.objects.create(
            invoice=invoice,
            payment=payment,
            document_type=InvoiceDocument.DocumentType.RECEIPT,
            file_name=receipt_filename,
            mime_type="application/pdf",
            content=receipt_pdf,
        )

        response = HttpResponse(receipt_pdf, content_type="application/pdf")
        response["Content-Disposition"] = f'attachment; filename="{receipt_filename}"'
        return response


class PaymentRecordViewSet(AdminWriteRequiredMixin, mixins.ListModelMixin, mixins.CreateModelMixin, viewsets.GenericViewSet):
    serializer_class = PaymentRecordSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        queryset = PaymentRecord.objects.select_related("invoice", "apartment", "apartment__building").all()
        month = self.request.query_params.get("month")
        if month:
            queryset = queryset.filter(invoice__month=month)
        if user.role in ("superadmin", "administrator"):
            return queryset.order_by("-payment_date", "-id")
        return queryset.filter(apartment__memberships__user=user).distinct().order_by("-payment_date", "-id")

    def create(self, request, *args, **kwargs):
        if not self.is_admin_write():
            return Response({"detail": "Απαγορεύεται."}, status=status.HTTP_403_FORBIDDEN)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        invoice = serializer.validated_data["invoice"]
        if invoice.outstanding_balance <= Decimal("0"):
            return Response({"detail": "Ο λογαριασμός είναι ήδη εξοφλημένος."}, status=status.HTTP_400_BAD_REQUEST)
        amount = Decimal(serializer.validated_data["amount"])
        if amount > Decimal(invoice.outstanding_balance):
            return Response({"detail": "Το ποσό πληρωμής δεν μπορεί να υπερβαίνει το υπόλοιπο."}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            payment = serializer.save()
            invoice.paid_total = q2(Decimal(invoice.paid_total) + Decimal(payment.amount))
            invoice.outstanding_balance = q2(Decimal(invoice.invoice_total) - Decimal(invoice.paid_total))
            invoice.status = Invoice.Status.PAID if invoice.outstanding_balance <= Decimal("0") else Invoice.Status.ISSUED
            invoice.save(update_fields=["paid_total", "outstanding_balance", "status", "updated_at"])

            receipt_filename, receipt_pdf = _create_receipt_pdf(invoice, payment)
            InvoiceDocument.objects.create(
                invoice=invoice,
                payment=payment,
                document_type=InvoiceDocument.DocumentType.RECEIPT,
                file_name=receipt_filename,
                mime_type="application/pdf",
                content=receipt_pdf,
            )
            dispatch = _send_receipt_email(invoice, payment, receipt_filename, receipt_pdf)

        response_data = self.get_serializer(payment).data
        response_data["notification_status"] = dispatch.status if dispatch else NotificationDispatch.Status.SENT
        return Response(response_data, status=status.HTTP_201_CREATED)
