from pathlib import Path

import pytest

from app.signup_policy import SignupPolicy, load_policy


def policy(**overrides) -> SignupPolicy:
    base = {"enforce": True, "allowed_domains": ["nwmissouri.edu"]}
    base.update(overrides)
    return SignupPolicy.from_mapping(base)


class TestDomainRule:
    def test_admits_an_allowed_domain(self):
        assert policy().allows("student@nwmissouri.edu") is True

    def test_rejects_any_other_domain(self):
        assert policy().allows("someone@gmail.com") is False

    def test_is_case_insensitive(self):
        assert policy().allows("Student@NWMissouri.EDU") is True

    def test_ignores_surrounding_whitespace(self):
        assert policy().allows("  student@nwmissouri.edu  ") is True

    def test_does_not_match_a_lookalike_suffix(self):
        # evil-nwmissouri.edu must not pass just because it ends the same way.
        assert policy().allows("attacker@evil-nwmissouri.edu") is False
        assert policy().allows("attacker@nwmissouri.edu.example.com") is False

    def test_supports_several_domains(self):
        multi = policy(allowed_domains=["nwmissouri.edu", "example.org"])
        assert multi.allows("a@example.org") is True
        assert multi.allows("a@nwmissouri.edu") is True
        assert multi.allows("a@other.com") is False


class TestMissingOrMalformedAddress:
    @pytest.mark.parametrize("address", [None, "", "   ", "not-an-email"])
    def test_rejects_anything_without_a_domain(self, address):
        # A token with no verifiable address cannot satisfy a domain rule, and
        # admitting it would make the policy trivially bypassable.
        assert policy().allows(address) is False


class TestExplicitLists:
    def test_allowed_email_overrides_the_domain_rule(self):
        guest = policy(allowed_emails=["advisor@example.com"])
        assert guest.allows("advisor@example.com") is True
        assert guest.allows("other@example.com") is False

    def test_blocked_email_beats_the_domain_rule(self):
        banned = policy(blocked_emails=["spammer@nwmissouri.edu"])
        assert banned.allows("spammer@nwmissouri.edu") is False
        assert banned.allows("student@nwmissouri.edu") is True

    def test_blocked_beats_allowed_for_the_same_address(self):
        both = policy(allowed_emails=["x@example.com"], blocked_emails=["x@example.com"])
        assert both.allows("x@example.com") is False


class TestEnforcementSwitch:
    def test_disabled_admits_everyone(self):
        assert policy(enforce=False).allows("anyone@anywhere.com") is True

    def test_disabled_admits_even_a_blocked_address(self):
        off = policy(enforce=False, blocked_emails=["x@y.com"])
        assert off.allows("x@y.com") is True

    def test_enforcing_with_no_domains_admits_everyone(self):
        # Far likelier a misedit than an intent to lock every user out.
        assert policy(allowed_domains=[]).allows("anyone@anywhere.com") is True


class TestDescribe:
    def test_names_the_allowed_domains(self):
        assert policy().describe() == "This planner is limited to @nwmissouri.edu accounts."

    def test_lists_several_domains_in_a_stable_order(self):
        multi = policy(allowed_domains=["example.org", "nwmissouri.edu"])
        assert multi.describe() == (
            "This planner is limited to @example.org, @nwmissouri.edu accounts."
        )

    def test_says_so_when_unrestricted(self):
        assert "not restricted" in policy(enforce=False).describe()


class TestLoading:
    def test_reads_the_shipped_policy_file(self):
        # The file the deployment actually uses; a typo here locks users out.
        loaded = load_policy()
        assert loaded.enforce is True
        assert "nwmissouri.edu" in loaded.allowed_domains

    def test_reads_an_explicit_path(self, tmp_path: Path):
        target = tmp_path / "custom.json"
        target.write_text('{"enforce": true, "allowed_domains": ["example.com"]}')
        assert load_policy(target).allowed_domains == ["example.com"]

    def test_a_missing_file_disables_enforcement(self, tmp_path: Path):
        # "No policy configured" must not mean "admit nobody".
        assert load_policy(tmp_path / "absent.json").enforce is False

    def test_normalises_case_and_whitespace_from_the_file(self, tmp_path: Path):
        target = tmp_path / "messy.json"
        target.write_text('{"allowed_domains": ["  NWMissouri.EDU  ", ""]}')
        assert load_policy(target).allowed_domains == ["nwmissouri.edu"]
