package dev.qarasky.koremind.ui.model

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import dev.qarasky.koremind.ui.theme.KoreMindColors

/** The provider's real logo in [tint], or its first letter in a circle when KoreMind has no logo for it. */
@Composable
fun ProviderIcon(id: String, name: String, size: Dp, tint: Color = KoreMindColors.Text) {
    val res = providerIconRes(id)
    if (res != null) Icon(painterResource(res), null, Modifier.size(size), tint = tint)
    else Box(Modifier.size(size).background(KoreMindColors.Raised, CircleShape), contentAlignment = Alignment.Center) {
        Text(name.take(1).uppercase(), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
    }
}
