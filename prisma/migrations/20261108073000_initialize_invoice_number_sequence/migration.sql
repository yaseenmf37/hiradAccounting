ALTER TABLE "Business"
ALTER COLUMN "nextInvoiceNumber" TYPE BIGINT;

DO $$
DECLARE
  invoice_row RECORD;
  business_row RECORD;
  normalized_number TEXT;
BEGIN
  FOR invoice_row IN
    SELECT "id", "businessId", "invoiceNumber"
    FROM "Invoice"
    WHERE "invoiceNumber" <> ''
      AND TRANSLATE("invoiceNumber", '0123456789', '') = ''
  LOOP
    normalized_number := COALESCE(NULLIF(LTRIM(invoice_row."invoiceNumber", '0'), ''), '0');

    IF LENGTH(normalized_number) > 19 OR (
      LENGTH(normalized_number) = 19
      AND normalized_number COLLATE "C" > '9223372036854775807' COLLATE "C"
    ) THEN
      RAISE EXCEPTION
        'Cannot initialize invoice number sequence: numeric invoice number for invoice % in business % exceeds BIGINT maximum.',
        invoice_row."id",
        invoice_row."businessId"
        USING ERRCODE = '22003';
    END IF;
  END LOOP;

  FOR business_row IN
    SELECT
      business."id",
      MAX(
        CASE
          WHEN invoice."invoiceNumber" <> ''
            AND TRANSLATE(invoice."invoiceNumber", '0123456789', '') = ''
          THEN COALESCE(NULLIF(LTRIM(invoice."invoiceNumber", '0'), ''), '0')::bigint
        END
      ) AS max_invoice_number
    FROM "Business" AS business
    LEFT JOIN "Invoice" AS invoice
      ON invoice."businessId" = business."id"
      AND invoice."invoiceNumber" <> ''
      AND TRANSLATE(invoice."invoiceNumber", '0123456789', '') = ''
    GROUP BY business."id"
  LOOP
    IF business_row.max_invoice_number >= 9223372036854775807 THEN
      RAISE EXCEPTION
        'Cannot initialize invoice number sequence for business %: next invoice number exceeds the BIGINT range of Business.nextInvoiceNumber.',
        business_row."id"
        USING ERRCODE = '22003';
    END IF;
  END LOOP;

  UPDATE "Business" AS business
  SET "nextInvoiceNumber" = GREATEST(
    1000::bigint,
    COALESCE(invoice_numbers.max_invoice_number + 1, 1000::bigint)
  )::bigint
  FROM (
    SELECT
      business."id",
      MAX(
        CASE
          WHEN invoice."invoiceNumber" <> ''
            AND TRANSLATE(invoice."invoiceNumber", '0123456789', '') = ''
          THEN COALESCE(NULLIF(LTRIM(invoice."invoiceNumber", '0'), ''), '0')::bigint
        END
      ) AS max_invoice_number
    FROM "Business" AS business
    LEFT JOIN "Invoice" AS invoice
      ON invoice."businessId" = business."id"
      AND invoice."invoiceNumber" <> ''
      AND TRANSLATE(invoice."invoiceNumber", '0123456789', '') = ''
    GROUP BY business."id"
  ) AS invoice_numbers
  WHERE business."id" = invoice_numbers."id";
END $$;
