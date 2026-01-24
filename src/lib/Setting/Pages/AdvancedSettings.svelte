<script lang="ts">
    import { advancedSettingsItems } from "src/ts/setting/advancedSettingsData";
    import SettingRenderer from "../SettingRenderer.svelte";
    import CheckInput from "../../UI/GUI/CheckInput.svelte";
    import { DBState } from "src/ts/stores.svelte";
    import { language } from "src/lang";
</script>

<div class="flex flex-col gap-2 p-2 w-full">
    <div class="flex justify-between items-center p-2 bg-darkbutton rounded-md">
        <span>{language.studioMode} Layout</span>
        <CheckInput bind:check={DBState.db.studioLayout} name="" />
    </div>
</div>
<SettingRenderer items={advancedSettingsItems} />
