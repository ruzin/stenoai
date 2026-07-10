"""Unit coverage for the transcript language detector (#283).

Parakeet never reports a detected language, so auto-mode meetings used to fall
back to English summaries. ``detect_transcript_language`` fills that gap with a
stopword classifier over the Parakeet-supported languages, and
``resolve_output_language`` slots it into the priority chain
(pin > engine-detected > text-detected > "en").
"""

import unittest

from simple_recorder import MeetingPipeline, resolve_output_language
from src.language_detect import detect_transcript_language

# Realistic meeting-style paragraphs (>=80 words each). Function-word rich so
# the aggregate classifier has enough signal, as a real transcript would.
EN_TEXT = (
    "So the main thing that we need to decide today is whether we should ship "
    "the new onboarding flow this week or wait until the next release. I think "
    "the data we have from the last test is good, but there are still a couple "
    "of things that could be better before we send it to all of our users. "
    "What would you like to do about the pricing page? Can we also talk about "
    "how the team will handle support when more people start using it, because "
    "that is the part that worries me the most right now."
)
FR_TEXT = (
    "Donc, la question que nous devons trancher aujourd'hui est de savoir si "
    "nous allons lancer le nouveau parcours cette semaine ou attendre la "
    "prochaine version. Je pense que les données que nous avons sont bonnes, "
    "mais il y a encore des choses qui pourraient être meilleures avant de "
    "les envoyer à tous nos utilisateurs. Que voulez-vous faire pour la page "
    "des prix ? Nous devons aussi parler de la façon dont l'équipe va gérer le "
    "support quand plus de personnes vont commencer à l'utiliser, parce que "
    "c'est la partie qui m'inquiète le plus."
)
DE_TEXT = (
    "Also, die Frage, die wir heute entscheiden müssen, ist, ob wir den neuen "
    "Ablauf diese Woche ausliefern oder bis zur nächsten Version warten "
    "sollen. Ich denke, dass die Daten, die wir aus dem letzten Test haben, "
    "gut sind, aber es gibt noch ein paar Dinge, die besser sein könnten, "
    "bevor wir es an alle unsere Nutzer schicken. Was möchtest du mit der "
    "Preisseite machen? Wir müssen auch darüber reden, wie das Team den "
    "Support macht, wenn mehr Leute anfangen, es zu benutzen, weil das der "
    "Teil ist, der mir am meisten Sorgen macht."
)
ES_TEXT = (
    "Entonces, la pregunta que tenemos que decidir hoy es si deberíamos lanzar "
    "el nuevo flujo esta semana o esperar hasta la próxima versión. Creo que "
    "los datos que tenemos de la última prueba son buenos, pero todavía hay un "
    "par de cosas que podrían ser mejores antes de enviarlo a todos nuestros "
    "usuarios. ¿Qué te gustaría hacer con la página de precios? También "
    "tenemos que hablar de cómo el equipo va a gestionar el soporte cuando más "
    "personas empiecen a usarlo, porque esa es la parte que más me preocupa "
    "en este momento."
)
NL_TEXT = (
    "Dus de vraag die we vandaag moeten beslissen is of we de nieuwe flow deze "
    "week gaan uitbrengen of wachten tot de volgende versie. Ik denk dat de "
    "gegevens die we van de laatste test hebben goed zijn, maar er zijn nog "
    "een paar dingen die beter kunnen voordat we het naar al onze gebruikers "
    "sturen. Wat wil je doen met de prijspagina? We moeten het er ook over "
    "hebben hoe het team de ondersteuning gaat doen wanneer meer mensen het "
    "gaan gebruiken, omdat dat het deel is waar ik me het meest zorgen over "
    "maak."
)
PT_TEXT = (
    "Então, a questão que precisamos decidir hoje é se devemos lançar o novo "
    "fluxo esta semana ou esperar até a próxima versão. Eu acho que os dados "
    "que temos do último teste são bons, mas ainda há algumas coisas que "
    "poderiam ser melhores antes de enviá-lo para todos os nossos usuários. O "
    "que você gostaria de fazer com a página de preços? Nós também precisamos "
    "falar sobre como a equipe vai lidar com o suporte quando mais pessoas "
    "começarem a usá-lo, porque essa é a parte que mais me preocupa agora."
)

# A diarised transcript with speaker markers and timestamps — the detector must
# ignore the [You]/[Others] labels and clock stamps and still read German.
DE_DIARISED_TEXT = (
    "[00:00:02] [You] Also ich denke, dass wir die neue Version diese Woche "
    "ausliefern sollten, weil die Daten wirklich gut sind.\n"
    "[00:00:11] [Others] Ja, aber wir müssen noch über den Support reden, "
    "wenn mehr Nutzer anfangen, es zu benutzen.\n"
    "[00:00:20] [You] Das stimmt. Was möchtest du mit der Preisseite machen, "
    "bevor wir es an alle unsere Kunden schicken?\n"
    "[00:00:29] [Others] Ich glaube, wir sollten hier noch ein paar Dinge "
    "besser machen, sonst gibt es zu viele Fragen."
)


class DetectTranscriptLanguageTests(unittest.TestCase):
    def test_detects_each_supported_language(self):
        cases = {
            "en": EN_TEXT,
            "fr": FR_TEXT,
            "de": DE_TEXT,
            "es": ES_TEXT,
            "nl": NL_TEXT,
            "pt": PT_TEXT,
        }
        for expected, text in cases.items():
            with self.subTest(language=expected):
                self.assertEqual(detect_transcript_language(text), expected)

    def test_ignores_diarisation_markers_and_timestamps(self):
        # Markers ([You]/[Others]) and [HH:MM:SS] stamps must not derail the
        # aggregate — this German transcript still reads as German.
        self.assertEqual(detect_transcript_language(DE_DIARISED_TEXT), "de")

    def test_mixed_text_dominated_by_german_is_de(self):
        mixed = (
            "Quick note in English at the start. " + DE_TEXT +
            " That is all for now, thanks everyone."
        )
        self.assertEqual(detect_transcript_language(mixed), "de")

    def test_empty_input_is_none(self):
        self.assertIsNone(detect_transcript_language(""))

    def test_none_input_is_none(self):
        self.assertIsNone(detect_transcript_language(None))

    def test_whitespace_only_input_is_none(self):
        self.assertIsNone(detect_transcript_language("   \n\t  "))

    def test_short_ambiguous_input_is_none(self):
        # Too few stopword hits to clear the evidence threshold.
        self.assertIsNone(detect_transcript_language("Okay. Yes. Thanks."))

    def test_numeric_and_symbol_only_input_is_none(self):
        self.assertIsNone(detect_transcript_language("123 456 !!! @@@ 00:12:34 ### 99"))


class ResolveOutputLanguagePriorityTests(unittest.TestCase):
    def test_pinned_config_wins_over_everything(self):
        # A concrete pin beats both an engine language and the transcript body.
        self.assertEqual(
            resolve_output_language("fr", detected_language="de", transcript_text=EN_TEXT),
            "fr",
        )

    def test_engine_detected_wins_over_text_detection(self):
        # In auto mode a real engine language (Whisper) takes precedence over
        # the text classifier, even if the text looks like another language.
        self.assertEqual(
            resolve_output_language("auto", detected_language="es", transcript_text=DE_TEXT),
            "es",
        )

    def test_text_detection_used_only_in_auto_plus_none(self):
        self.assertEqual(
            resolve_output_language("auto", detected_language=None, transcript_text=DE_TEXT),
            "de",
        )

    def test_falls_back_to_en_when_detector_inconclusive(self):
        self.assertEqual(
            resolve_output_language("auto", detected_language=None, transcript_text="Yes. No."),
            "en",
        )

    def test_falls_back_to_en_without_transcript(self):
        self.assertEqual(resolve_output_language("auto"), "en")

    def test_method_delegates_to_module_function(self):
        # The MeetingPipeline method is a thin delegate — same priority result
        # without constructing the (heavy) pipeline.
        recorder = MeetingPipeline.__new__(MeetingPipeline)
        self.assertEqual(
            recorder._resolve_output_language("auto", None, transcript_text=FR_TEXT),
            "fr",
        )
        self.assertEqual(recorder._resolve_output_language("de"), "de")


if __name__ == "__main__":
    unittest.main()
