"""Regression tests for the Bedrock Converse URL builder.

The original release shipped two copies of this URL-encoding logic — one
in src/summarizer._bedrock_chat and another in
simple_recorder.test_cloud_api — both with the same too-narrow safe set
(``":.-"``). That worked for system inference profile ids and bare model
ids, but silently broke for application inference profile ARNs in
governed AWS environments because the ARN contains a path-style
``application-inference-profile/<id>`` segment. Percent-encoding the
slash produced HTTP 400 "model identifier invalid".

These tests pin the three concrete shapes we expect to construct URLs
for, so a regression on the safe set surfaces here before it ships.
"""
import unittest

from src.summarizer import bedrock_converse_url


class BedrockConverseUrlTests(unittest.TestCase):
    def test_application_inference_profile_arn_keeps_slash(self):
        arn = (
            "arn:aws:bedrock:eu-west-2:745078845594:"
            "application-inference-profile/acgdk9re2ouo"
        )
        url = bedrock_converse_url("eu-west-2", arn)
        # The slash inside the ARN survives URL construction. If it got
        # percent-encoded to %2F, Bedrock returns "model identifier invalid".
        self.assertNotIn("%2F", url)
        self.assertNotIn("%2f", url)
        # Spot-check the segment is intact.
        self.assertIn("application-inference-profile/acgdk9re2ouo", url)
        # Host + path shape.
        self.assertTrue(
            url.startswith("https://bedrock-runtime.eu-west-2.amazonaws.com/model/")
        )
        self.assertTrue(url.endswith("/converse"))

    def test_system_inference_profile_id_unchanged(self):
        # The Anthropic system profile shape from the AWS docs. No
        # characters that would be percent-encoded under either old or
        # new safe set.
        profile = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
        url = bedrock_converse_url("us-east-1", profile)
        self.assertIn(f"/model/{profile}/converse", url)

    def test_bare_model_id_unchanged(self):
        # Direct-invoke shape. Same expectations as the system profile —
        # the test exists so a future "tighten the safe set" change can't
        # silently break direct invocation either.
        model = "anthropic.claude-haiku-4-5-20251001-v1:0"
        url = bedrock_converse_url("us-east-1", model)
        self.assertIn(f"/model/{model}/converse", url)

    def test_region_lands_in_host_segment(self):
        # Defensive — ensures the region argument flows through rather
        # than getting silently dropped into the path.
        url = bedrock_converse_url("ap-southeast-2", "model-x")
        self.assertIn("bedrock-runtime.ap-southeast-2.amazonaws.com", url)


if __name__ == "__main__":
    unittest.main()
